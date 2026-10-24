import { app, BrowserWindow } from 'electron'
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
import { IPC } from '@inkcraft/shared'
import type { AiEvent } from '@inkcraft/shared'
import { BUILTIN_TEMPLATES, parseCharacterCards, parseOutlineBatch } from '@inkcraft/core'
import { registerIpc } from './ipc'

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
function runSmoke(
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
  }
): void {
  const { library, settings, templates, snapshots, writing, codex, outline, genesis } = services

  // --- 图书链路 ---
  const project = library.createProject({ title: `冒烟测试 ${Date.now()}`, genre: '玄幻' })
  const volumes = library.listVolumes(project.id)
  const chapter = library.createChapter({ projectId: project.id, volumeId: volumes[0].id })
  const saved = library.saveChapter({
    id: chapter.id,
    title: '第一章 醒来',
    content: '林凡睁开眼，发现自己回到了十八岁那年夏天。蝉鸣声穿过纱窗，涌进这间狭小的出租屋。'
  })

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
  if (!rendered.prompt.includes(saved.content) || rendered.prompt.includes('前文情节')) {
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
  if (!codex.listPinned(project.id).some((e) => e.id === world.id)) throw new Error('pinned 条目缺失')
  if (codex.matchCharacters(project.id, ['小聋子'])[0]?.id !== hero.id) throw new Error('别名匹配失败')
  const characterList = codex.list(project.id, 'character')
  if (characterList.length !== 1 || characterList[0].id !== hero.id) throw new Error('类型过滤失败')

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
    chapterNo: 1,
    goal: '林凡醒来，发现重生（修订）',
    plotPoints: ['确认重生', '发现金手指', '藏起锋芒'],
    characters: ['小聋子'],
    endingHook: '仇人上门'
  })
  const outlineNodes = outline.listChapters(project.id)
  if (outlineNodes.length !== 1 || outlineNodes[0].plotPoints.length !== 3) {
    throw new Error('章纲 upsert 异常（应合并为一条）')
  }

  // --- 续写上下文：章纲 + 世界观 + 角色卡注入 T-06 ---
  const built = writing.buildContinuePrompt(chapter.id, { wordCount: 800 })
  if (!built.prompt.includes('本章大纲') || !built.prompt.includes('仇人上门')) {
    throw new Error('续写上下文未注入章纲')
  }
  if (!built.prompt.includes('世界观核心设定') || !built.prompt.includes('九州大陆')) {
    throw new Error('续写上下文未注入世界观常驻卡')
  }
  if (!built.prompt.includes('出场角色档案') || !built.prompt.includes('小聋子')) {
    throw new Error('续写上下文未注入出场角色档案（别名应解析为角色卡）')
  }

  // --- 创世提示词构建 ---
  const genesisPrompt = genesis.buildGenesisPrompt({
    projectId: project.id,
    step: 'world',
    input: { idea: '修仙世界里的时间循环者', styleKeywords: '热血,冷静', hasGoldenFinger: true }
  })
  if (!genesisPrompt.prompt.includes('时间循环者')) throw new Error('创世提示词构建异常')

  // --- 快照：创建 -> 修改 -> 恢复回环 ---
  const snap = snapshots.create(chapter.id, 'before_ai', '冒烟快照')
  library.saveChapter({ id: chapter.id, content: '被覆盖的内容' })
  const restored = snapshots.restore(snap.id, (id, content) => library.saveChapter({ id, content }))
  if (restored.content !== saved.content) throw new Error('快照恢复后内容不一致')

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
  probe
    .drain()
    .then(() => {
      if (!events.some((e) => e.type === 'error')) throw new Error('未配置模型时未广播 error 事件')
      const logCount = (db.prepare('SELECT COUNT(*) AS c FROM ai_logs').get() as { c: number }).c
      if (logCount < 1) throw new Error('ai_logs 未记录失败调用')

      library.deleteProject(project.id)
      console.log('[smoke] OK: 图书/模板/解析器/Codex/大纲/T-06注入/创世/快照/编排器失败路径 全链路通过')
      app.quit()
    })
    .catch((err) => {
      console.error('[smoke] FAILED:', err)
      app.exit(1)
    })
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
    const writing = new WritingService(db, library, templates, codex, outline)
    const orchestrator = new AiOrchestrator(db, settings, (event) => {
      mainWindow?.webContents.send(IPC.AIEvent, event)
    })

    registerIpc(
      { library, settings, writing, snapshots, orchestrator, codex, outline, genesis },
      { version: app.getVersion(), dbPath: db.name }
    )
    createWindow()

    if (process.env.INKCRAFT_SMOKE) {
      setTimeout(() => {
        runSmoke(db, { library, settings, templates, snapshots, writing, codex, outline, genesis })
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
