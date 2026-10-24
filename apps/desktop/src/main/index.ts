import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { closeDb, initDb } from './db/database'
import { LibraryService } from './services/libraryService'
import { SettingService } from './services/settingService'
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
  // 渲染层报错转发到主进程日志（冒烟测试据此捕获 UI 运行时错误）
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level === 'error') console.log(`[renderer-error] ${message}`)
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'bottom' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** 冒烟模式：不依赖 UI 交互，直接验证主进程服务层（建书/建章/保存/删除），跑完自动退出 */
function runSmoke(service: LibraryService, settingService: SettingService): void {
  // --- 图书链路 ---
  const project = service.createProject({ title: `冒烟测试 ${Date.now()}` })
  const projects = service.listProjects()
  const volumes = service.listVolumes(project.id)
  const chapter = service.createChapter({ projectId: project.id, volumeId: volumes[0].id })
  const saved = service.saveChapter({
    id: chapter.id,
    title: '第一章 醒来',
    content: '林凡睁开眼，发现自己回到了十八岁那年夏天。蝉鸣声穿过纱窗，涌进这间狭小的出租屋。'
  })
  const fetched = service.getChapter(chapter.id)

  if (projects.length < 1) throw new Error('项目列表为空')
  if (!fetched || fetched.wordCount !== saved.wordCount || fetched.content !== saved.content) {
    throw new Error('章节保存后读取不一致')
  }
  service.deleteProject(project.id)

  // --- 设置链路：Provider CRUD + Key 加解密回环 + 模型分工 ---
  const provider = settingService.createProvider({
    name: '冒烟Provider',
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-smoke-test',
    models: ['model-a', 'model-b']
  })
  if (settingService.getApiKey(provider.id) !== 'sk-smoke-test') {
    throw new Error('API Key 加解密回环失败')
  }
  const settings = settingService.getSettings()
  const providerDTO = settings.providers.find((p) => p.id === provider.id)
  if (!providerDTO || !providerDTO.hasKey || providerDTO.baseUrl !== 'https://api.example.com/v1') {
    throw new Error('Provider 创建后读取失败或 Key 状态不正确')
  }
  if ('apiKeyEnc' in providerDTO) throw new Error('Provider DTO 泄漏了加密 Key 字段')

  const savedConfig = settingService.saveModelConfig({
    continue: { providerId: provider.id, model: 'model-a' }
  })
  if (savedConfig.continue?.model !== 'model-a') throw new Error('模型分工保存失败')

  settingService.deleteProvider(provider.id)
  if (settingService.getSettings().modelConfig.continue) {
    throw new Error('删除 Provider 后模型分工未清理')
  }

  console.log(
    `[smoke] OK: 建书/建章/保存/删除 + Provider CRUD/Key回环/模型分工 全链路通过`
  )
}

app.whenReady()
  .then(() => {
    const db = initDb()
    const service = new LibraryService(db)
    const settingService = new SettingService(db)
    registerIpc(service, settingService, { version: app.getVersion(), dbPath: db.name })
    createWindow()

    if (process.env.INKCRAFT_SMOKE) {
      setTimeout(() => {
        try {
          runSmoke(service, settingService)
          app.quit()
        } catch (err) {
          console.error('[smoke] FAILED:', err)
          app.exit(1)
        }
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
