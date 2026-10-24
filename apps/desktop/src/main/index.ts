import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { closeDb, initDb } from './db/database'
import { seedTemplates } from './services/templateService'
import { TemplateService } from './services/templateService'
import { LibraryService } from './services/libraryService'
import { SettingService } from './services/settingService'
import { SnapshotService } from './services/snapshotService'
import { WritingService } from './services/writingService'
import { AiOrchestrator } from './services/aiOrchestrator'
import { CodexService } from './services/codexService'
import { OutlineService } from './services/outlineService'
import { GenesisService } from './services/genesisService'
import { EmbeddingClient } from './services/embeddingClient'
import { RagService } from './services/ragService'
import { MemoryService } from './services/memoryService'
import { ExportService } from './services/exportService'
import { IPC } from '@inkcraft/shared'
import type { AiEvent } from '@inkcraft/shared'
import { BUILTIN_TEMPLATES, buildExportText, chunkText, parseCharacterCards, parseOutlineBatch } from '@inkcraft/core'
import { registerIpc } from './ipc'
import { runBench } from './bench'
import { runE2E } from './e2e'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1c20',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // 渲染层报错转发到主进程日志（冒烟测试据此捕获 UI 运行时错误；level 3 = error）
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level === 3) console.log(`[renderer-error] ${message}`)
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'bottom' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** 冒烟模式：不依赖 UI 交互，直接验证主进程服务层，跑完自动退出 */
async function runSmoke(
  db: import('better-sqlite3').Database,
  services: {
    library: LibraryService
    settings: SettingService
    templates: TemplateService
    snapshots: SnapshotService
    writing: WritingService
    codex: CodexService
    outline: OutlineService
    genesis: GenesisService
    rag: RagService
    memory: MemoryService
    exporter: ExportService
  }
): Promise<void> {
  const { library, settings, templates, snapshots, writing, codex, outline, genesis, rag, memory, exporter } =
    services

  // --- 图书链路 ---
  const project = library.createProject({ title: `冒烟测试 ${Date.now()}`, genre: '玄幻' })
  const volumes = library.listVolumes(project.id)
  const chapter = library.createChapter({ projectId: project.id, volumeId: volumes[0].id })
  const saved = library.saveChapter({
    id: chapter.id,
    title: '第一章 醒来',
    content: '林凡睁开眼，发现自己回到了十八岁那年夏天。蝉鸣声穿过纱窗，涌进这间狭小的出租屋。'
  })
  const chapter2 = library.createChapter({ projectId: project.id, volumeId: volumes[0].id })

  // --- 模板：seed upsert + 渲染 ---
  const tplCount = (
    db.prepare('SELECT COUNT(*) AS c FROM prompt_templates').get() as { c: number }
  ).c
  if (tplCount !== BUILTIN_TEMPLATES.length) throw new Error(`内置模板数量异常: ${tplCount}`)
  const rendered = templates.render('T-06', {
    genre: '玄幻',
    styleGuide: '白描',
    pov: '第三人称',
    bannedList: '眼眸',
    prevContext: '',
    textTail: saved.content,
    wordCount: 800,
    directive: ''
  })
  if (!rendered.prompt.includes(saved.content) || rendered.prompt.includes('前文记忆')) {
    throw new Error('T-06 渲染结果异常（正文尾部缺失或空条件块未裁剪）')
  }

  // --- 解析器：角色卡 Markdown 切分 + 章纲 JSON 提取 ---
  const cards = parseCharacterCards('### 林凡\n- 身份：废柴少年\n- 性格：坚韧，认死理\n\n### 苏若雪\n- 身份：宗门圣女')
  if (cards.length !== 2 || cards[0].name !== '林凡' || !cards[1].content.includes('圣女')) {
    throw new Error('角色卡解析异常')
  }
  const parsedOutline = parseOutlineBatch(
    '好的，以下是章纲：\n```json\n[{"no":3,"title":"试探","goal":"林凡潜入藏经阁","plotPoints":["翻墙","遇巡逻"],"characters":["林凡"],"endingHook":"阁中黑影"}]\n```\n'
  )
  if (parsedOutline.length !== 1 || parsedOutline[0].no !== 3 || parsedOutline[0].plotPoints.length !== 2) {
    throw new Error('章纲 JSON 解析异常')
  }

  // --- 切片器：段落聚合 + 实体标注 ---
  const sampleText = Array.from(
    { length: 20 },
    (_, i) => `第${i + 1}段。林凡走进藏经阁，翻开了那本残卷，里面的文字晦涩难懂，他却看得入神，不知不觉天色已晚。`
  ).join('\n\n')
  const chunks = chunkText(sampleText, ['林凡', '藏经阁'])
  if (chunks.length < 2) throw new Error(`切片数量异常: ${chunks.length}`)
  if (!chunks.some((c) => c.entities.includes('林凡') && c.entities.includes('藏经阁'))) {
    throw new Error('切片实体标注缺失')
  }

  // --- Codex：CRUD + pinned + 别名匹配 ---
  const world = codex.create({
    projectId: project.id,
    type: 'world',
    name: '世界观',
    importance: 'pinned',
    content: '灵气复苏后的九州大陆，修炼体系分九境。'
  })
  const hero = codex.create({
    projectId: project.id,
    type: 'character',
    name: '林凡',
    aliases: ['小聋子', '凡哥'],
    content: '主角，坚韧，遇事先苟后爆发。'
  })
  const location = codex.create({
    projectId: project.id,
    type: 'location',
    name: '藏经阁',
    content: '宗门禁地，存放上古残卷，夜里有人巡逻。'
  })
  if (!codex.listPinned(project.id).some((e) => e.id === world.id)) throw new Error('pinned 条目缺失')
  if (codex.matchCharacters(project.id, ['小聋子'])[0]?.id !== hero.id) throw new Error('别名匹配失败')

  // --- 大纲：总纲 + 章纲 upsert ---
  outline.saveBook({ projectId: project.id, content: '一句话梗概：废柴少年逆天改命。' })
  outline.saveChapter({
    projectId: project.id,
    volumeId: volumes[0].id,
    chapterNo: 1,
    goal: '林凡醒来，发现重生',
    plotPoints: ['确认重生', '发现金手指'],
    characters: ['小聋子'],
    endingHook: '仇人上门'
  })
  outline.saveChapter({
    projectId: project.id,
    volumeId: volumes[0].id,
    chapterNo: 2,
    goal: '夜探藏经阁',
    plotPoints: ['翻墙入阁', '遭遇黑影'],
    characters: ['林凡', '小聋子'],
    endingHook: '黑影转身'
  })
  if (outline.listChapters(project.id).length !== 2) throw new Error('章纲数量异常')

  // --- 记忆 + RAG：章后摘要 -> 索引 -> 续写上下文注入 ---
  const summary = await memory.saveSummary({
    projectId: project.id,
    chapterNo: 1,
    content: '林凡重生回到十八岁，确认自己握有时间循环的金手指，仇人王虎当日将上门寻衅。'
  })
  if (memory.getSummary(project.id, 1)?.id !== summary.id) throw new Error('摘要读取异常')

  // 检索级设定入索引（pinned 的世界观不入 RAG，走常驻区块）
  await rag.indexCodexEntry(location)
  await rag.indexCodexEntry(hero)

  library.saveChapter({
    id: chapter2.id,
    title: '第二章 夜探',
    content: '夜色落下。林凡换上夜行衣，绕开巡夜弟子，朝藏经阁摸去。'
  })

  const built = await writing.buildContinuePrompt(chapter2.id, { wordCount: 800 })
  if (!built.prompt.includes('本章大纲') || !built.prompt.includes('夜探藏经阁')) {
    throw new Error('续写上下文未注入章纲')
  }
  if (!built.prompt.includes('世界观核心设定') || !built.prompt.includes('九州大陆')) {
    throw new Error('续写上下文未注入世界观常驻卡')
  }
  if (!built.prompt.includes('出场角色档案') || !built.prompt.includes('小聋子')) {
    throw new Error('续写上下文未注入出场角色档案（别名应解析为角色卡）')
  }
  if (!built.prompt.includes('摘要') || !built.prompt.includes('时间循环')) {
    throw new Error('前文记忆未使用章后摘要')
  }
  if (!built.prompt.includes('补充资料') || !built.prompt.includes('宗门禁地')) {
    throw new Error('RAG 补充资料未命中藏经阁设定（关键词通道）')
  }
  const ragStatus = rag.getStatus(project.id)
  if (ragStatus.chunks < 3 || ragStatus.embedded !== 0 || ragStatus.embeddingConfigured) {
    throw new Error(`RAG 索引状态异常: ${JSON.stringify(ragStatus)}`)
  }

  // --- 创世提示词构建 ---
  const genesisPrompt = genesis.buildGenesisPrompt({
    projectId: project.id,
    step: 'world',
    input: { idea: '修仙世界里的时间循环者', styleKeywords: '热血,冷静', hasGoldenFinger: true }
  })
  if (!genesisPrompt.prompt.includes('时间循环者')) throw new Error('创世提示词构建异常')

  // --- 摘要提示词构建 ---
  const summaryPrompt = memory.buildSummaryPrompt(chapter2.id)
  if (!summaryPrompt.prompt.includes('夜色落下')) throw new Error('摘要提示词未包含正文')

  // --- 快照：创建 -> 修改 -> 恢复回环 ---
  const snap = snapshots.create(chapter.id, 'before_ai', '冒烟快照')
  library.saveChapter({ id: chapter.id, content: '被覆盖的内容' })
  const restored = snapshots.restore(snap.id, (id, content) => library.saveChapter({ id, content }))
  if (restored.content !== saved.content) throw new Error('快照恢复后内容不一致')

  // --- 导出文本构建 ---
  const exportChapters = exporter.getChapters(project.id)
  const exportText = buildExportText('冒烟测试之书', exportChapters)
  if (!exportText.includes('第一章 醒来') || !exportText.includes('蝉鸣声') || !exportText.includes('【第一卷】')) {
    throw new Error('导出文本构建异常')
  }

  // --- 编排器：未配置模型时的失败路径（独立探针实例验证日志 + error 事件） ---
  const events: AiEvent[] = []
  const probe = new AiOrchestrator(db, settings, (e) => events.push(e))
  probe.enqueue({
    requestId: 'smoke-request',
    scene: 'continue',
    prompt: 'test',
    temperature: 0.8,
    maxTokens: 100
  })
  await probe.drain()
  if (!events.some((e) => e.type === 'error')) throw new Error('未配置模型时未广播 error 事件')
  const logCount = (db.prepare('SELECT COUNT(*) AS c FROM ai_logs').get() as { c: number }).c
  if (logCount < 1) throw new Error('ai_logs 未记录失败调用')

  library.deleteProject(project.id)
  console.log('[smoke] OK: 图书/模板/解析器/切片器/Codex/大纲/记忆摘要/RAG检索注入/创世/快照/导出/编排器失败路径 全链路通过')
}

app.whenReady()
  .then(() => {
    const db = initDb()
    seedTemplates(db)

    const library = new LibraryService(db)
    const settings = new SettingService(db)
    const templates = new TemplateService(db)
    const snapshots = new SnapshotService(db, (id) => library.getChapter(id))
    const codex = new CodexService(db, (id) => library.getProject(id)?.title ?? null)
    const outline = new OutlineService(
      db,
      (id) => library.getProject(id) !== null,
      (id) => library.getVolume(id) !== null
    )
    const genesis = new GenesisService(library, codex, outline, templates)
    const embedding = new EmbeddingClient(settings)
    const rag = new RagService(db, embedding, library, codex)
    const memory = new MemoryService(db, library, outline, templates, rag)
    const writing = new WritingService(db, library, templates, codex, outline, rag, memory)
    const exporter = new ExportService(db)
    const orchestrator = new AiOrchestrator(db, settings, (event) => {
      mainWindow?.webContents.send(IPC.AIEvent, event)
    })

    registerIpc(
      {
        library,
        settings,
        writing,
        snapshots,
        orchestrator,
        codex,
        outline,
        genesis,
        rag,
        memory,
        exporter,
        saveDialog: async (defaultFileName, ext) => {
          if (!mainWindow) return null
          const res = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultFileName,
            filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
          })
          return res.canceled || !res.filePath ? null : res.filePath
        },
        getProjectTitle: (id) => library.getProject(id)?.title ?? null
      },
      { version: app.getVersion(), dbPath: db.name }
    )
    createWindow()

    if (process.env.INKCRAFT_SMOKE) {
      setTimeout(() => {
        runSmoke(db, { library, settings, templates, snapshots, writing, codex, outline, genesis, rag, memory, exporter })
          .then(() => app.quit())
          .catch((err) => {
            console.error('[smoke] FAILED:', err)
            app.exit(1)
          })
      }, 1500)
    }

    // 压测模式：构造 500 章百万字合成书，量测各环节延迟（INKCRAFT_BENCH=1）
    if (process.env.INKCRAFT_BENCH) {
      setTimeout(() => {
        runBench({ library, codex, rag, memory, writing, dbPath: db.name })
          .then(() => app.quit())
          .catch((err) => {
            console.error('[bench] FAILED:', err)
            app.exit(1)
          })
      }, 1500)
    }

    // 真实 E2E：走完整生成链路（INKCRAFT_E2E=1）
    // 用法 A（真实模型）：INKCRAFT_E2E_PROVIDER="Z.ai Coding Plan"
    // 用法 B（mock）：INKCRAFT_E2E_BASE_URL=http://127.0.0.1:8787 INKCRAFT_E2E_PROTOCOL=anthropic
    //                 INKCRAFT_E2E_API_KEY=test-key INKCRAFT_E2E_MODELS=GLM-5.3-Flash
    if (process.env.INKCRAFT_E2E) {
      setTimeout(() => {
        runE2E(
          {
            library, settings, codex, outline, genesis, writing, memory,
            makeOrchestrator: (emit) => new AiOrchestrator(db, settings, emit)
          },
          {
            providerName: process.env.INKCRAFT_E2E_PROVIDER,
            baseUrl: process.env.INKCRAFT_E2E_BASE_URL,
            apiKey: process.env.INKCRAFT_E2E_API_KEY,
            protocol: process.env.INKCRAFT_E2E_PROTOCOL as 'openai' | 'anthropic' | undefined,
            createName: process.env.INKCRAFT_E2E_NAME,
            models: process.env.INKCRAFT_E2E_MODELS?.split(',').map((m) => m.trim()).filter(Boolean)
          }
        )
          .then(() => app.quit())
          .catch((err) => {
            console.error('[e2e] FAILED:', err)
            app.exit(1)
          })
      }, 1500)
    }
  })
  .catch((err) => {
    console.error('[main] startup failed:', err)
    app.quit()
  })

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
