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
import { IPC } from '@inkcraft/shared'
import type { AiEvent } from '@inkcraft/shared'
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
  }
): void {
  const { library, settings, templates, snapshots, writing } = services

  // --- 图书链路 ---
  const project = library.createProject({ title: `冒烟测试 ${Date.now()}` })
  const volumes = library.listVolumes(project.id)
  const chapter = library.createChapter({ projectId: project.id, volumeId: volumes[0].id })
  const saved = library.saveChapter({
    id: chapter.id,
    title: '第一章 醒来',
    content: '林凡睁开眼，发现自己回到了十八岁那年夏天。蝉鸣声穿过纱窗，涌进这间狭小的出租屋。'
  })

  // --- 模板：seed 幂等 + 渲染 ---
  const tplCount = (
    db.prepare('SELECT COUNT(*) AS c FROM prompt_templates').get() as { c: number }
  ).c
  if (tplCount !== 2) throw new Error(`内置模板数量异常: ${tplCount}`)
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

  // --- 续写提示词构建 ---
  const built = writing.buildContinuePrompt(chapter.id, { wordCount: 800 })
  if (!built.prompt.includes('最近正文') || !built.prompt.includes(saved.content)) {
    throw new Error('续写上下文构建异常')
  }

  // --- 快照：创建 -> 修改 -> 恢复回环 ---
  const snap = snapshots.create(chapter.id, 'before_ai', '冒烟快照')
  library.saveChapter({ id: chapter.id, content: '被覆盖的内容' })
  const restored = snapshots.restore(snap.id, (id, content) => library.saveChapter({ id, content }))
  if (restored.content !== saved.content) throw new Error('快照恢复后内容不一致')
  if (snapshots.list(chapter.id).length < 1) throw new Error('快照列表为空')

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
      console.log('[smoke] OK: 图书/模板渲染/续写上下文/快照回环/编排器失败路径 全链路通过')
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
    const writing = new WritingService(db, library, templates)
    const orchestrator = new AiOrchestrator(db, settings, (event) => {
      mainWindow?.webContents.send(IPC.AIEvent, event)
    })

    registerIpc({ library, settings, writing, snapshots, orchestrator }, { version: app.getVersion(), dbPath: db.name })
    createWindow()

    if (process.env.INKCRAFT_SMOKE) {
      setTimeout(() => {
        runSmoke(db, { library, settings, templates, snapshots, writing })
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
