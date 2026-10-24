import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { IPC } from '@inkcraft/shared'
import type {
  AiStartResult,
  AppInfoDTO,
  CreateChapterPayload,
  CreateCodexPayload,
  CreateProjectPayload,
  CreateProviderPayload,
  ExportParams,
  GenesisParams,
  ModelConfigDTO,
  OutlineBatchParams,
  PolishParams,
  ProviderTestPayload,
  RagStatusDTO,
  SaveBookOutlinePayload,
  SaveChapterOutlinePayload,
  SaveChapterPayload,
  SaveSummaryPayload,
  SaveVolumeOutlinePayload,
  SnapshotKind,
  UpdateCodexPayload,
  UpdateProjectPayload,
  UpdateProviderPayload
} from '@inkcraft/shared'
import {
  continueParamsSchema,
  exportParamsSchema,
  genesisParamsSchema,
  outlineBatchParamsSchema,
  polishParamsSchema,
  summarizeParamsSchema
} from '@inkcraft/core'
import type { LibraryService } from './services/libraryService'
import type { SettingService } from './services/settingService'
import type { SnapshotService } from './services/snapshotService'
import type { WritingService } from './services/writingService'
import type { AiOrchestrator } from './services/aiOrchestrator'
import type { CodexService } from './services/codexService'
import type { OutlineService } from './services/outlineService'
import type { GenesisService } from './services/genesisService'
import type { RagService } from './services/ragService'
import type { MemoryService } from './services/memoryService'
import { ExportService } from './services/exportService'

export interface MainServices {
  library: LibraryService
  settings: SettingService
  writing: WritingService
  snapshots: SnapshotService
  orchestrator: AiOrchestrator
  codex: CodexService
  outline: OutlineService
  genesis: GenesisService
  rag: RagService
  memory: MemoryService
  exporter: ExportService
  /** 系统保存对话框（主进程注入，便于测试） */
  saveDialog: (defaultFileName: string, ext: string) => Promise<string | null>
  getProjectTitle: (id: string) => string | null
}

/**
 * 注册全部 IPC 通道。preload 侧的 InkcraftApi 与这里的参数/返回一一对应，
 * 契约以 packages/shared 的 IPC 常量为准。
 */
export function registerIpc(
  services: MainServices,
  meta: { version: string; dbPath: string }
): void {
  const { library, settings, writing, snapshots, orchestrator, codex, outline, genesis, rag, memory } =
    services

  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (_event, ...args) => {
      try {
        return fn(...args)
      } catch (err) {
        // zod 校验错误等信息透传给渲染层
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    })
  }

  handle(IPC.AppInfo, (): AppInfoDTO => ({ ...meta, platform: process.platform }))
  handle(IPC.ProjectList, () => library.listProjects())
  handle(IPC.ProjectCreate, (p) => library.createProject(p as CreateProjectPayload))
  handle(IPC.ProjectUpdate, (p) => library.updateProject(p as UpdateProjectPayload))
  handle(IPC.ProjectDelete, (id) => library.deleteProject(id as string))
  handle(IPC.VolumeList, (projectId) => library.listVolumes(projectId as string))
  handle(IPC.VolumeCreate, (projectId, title) =>
    library.createVolume(projectId as string, title as string)
  )
  handle(IPC.ChapterList, (projectId) => library.listChapters(projectId as string))
  handle(IPC.ChapterGet, (chapterId) => library.getChapter(chapterId as string))
  handle(IPC.ChapterCreate, (p) => library.createChapter(p as CreateChapterPayload))
  handle(IPC.ChapterSave, (p) => library.saveChapter(p as SaveChapterPayload))

  handle(IPC.SettingsGet, () => settings.getSettings())
  handle(IPC.ProviderCreate, (p) => settings.createProvider(p as CreateProviderPayload))
  handle(IPC.ProviderUpdate, (p) => settings.updateProvider(p as UpdateProviderPayload))
  handle(IPC.ProviderDelete, (id) => settings.deleteProvider(id as string))
  handle(IPC.ProviderTest, (p) => settings.testProvider(p as ProviderTestPayload))
  handle(IPC.ModelConfigSave, (c) => settings.saveModelConfig(c as ModelConfigDTO))

  // ---------- AI 生成（入队后立即返回，事件经 IPC.AIEvent 广播） ----------

  handle(IPC.AIContinue, async (p): Promise<AiStartResult> => {
    const params = continueParamsSchema.parse(p)
    const built = await writing.buildContinuePrompt(params.chapterId, params)
    const snapshot = snapshots.create(params.chapterId, 'before_ai', 'AI 续写前')
    const requestId = randomUUID()
    orchestrator.enqueue({
      requestId,
      scene: 'continue',
      prompt: built.prompt,
      templateCode: built.templateCode,
      temperature: built.temperature,
      maxTokens: built.maxTokens
    })
    return { requestId, snapshotId: snapshot.id }
  })

  handle(IPC.AIPolish, (p): AiStartResult => {
    const params = polishParamsSchema.parse(p as PolishParams)
    const built = writing.buildPolishPrompt(params)
    const requestId = randomUUID()
    orchestrator.enqueue({
      requestId,
      scene: 'polish',
      prompt: built.prompt,
      templateCode: built.templateCode,
      temperature: built.temperature,
      maxTokens: built.maxTokens
    })
    return { requestId }
  })

  handle(IPC.AISummarize, (p): AiStartResult => {
    const params = summarizeParamsSchema.parse(p)
    const built = memory.buildSummaryPrompt(params.chapterId)
    const requestId = randomUUID()
    orchestrator.enqueue({
      requestId,
      scene: 'extract',
      prompt: built.prompt,
      templateCode: built.templateCode,
      temperature: built.temperature,
      maxTokens: built.maxTokens
    })
    return { requestId }
  })

  handle(IPC.AIGenesis, (p): AiStartResult => {
    const params = genesisParamsSchema.parse(p as GenesisParams)
    const built = genesis.buildGenesisPrompt(params)
    const requestId = randomUUID()
    orchestrator.enqueue({
      requestId,
      scene: 'genesis',
      prompt: built.prompt,
      templateCode: built.templateCode,
      temperature: built.temperature,
      maxTokens: built.maxTokens
    })
    return { requestId }
  })

  handle(IPC.AIOutlineBatch, (p): AiStartResult => {
    const params = outlineBatchParamsSchema.parse(p as OutlineBatchParams)
    const built = genesis.buildOutlineBatchPrompt(params)
    const requestId = randomUUID()
    orchestrator.enqueue({
      requestId,
      scene: 'outline',
      prompt: built.prompt,
      templateCode: built.templateCode,
      temperature: built.temperature,
      maxTokens: built.maxTokens
    })
    return { requestId }
  })

  handle(IPC.AICancel, (requestId) => orchestrator.cancel(requestId as string))

  // ---------- 快照 ----------

  handle(IPC.SnapshotList, (chapterId) => snapshots.list(chapterId as string))
  handle(IPC.SnapshotCreate, (chapterId, kind, title) =>
    snapshots.create(chapterId as string, kind as SnapshotKind, title as string)
  )
  handle(IPC.SnapshotRestore, (snapshotId) =>
    snapshots.restore(snapshotId as string, (chapterId, content) =>
      library.saveChapter({ id: chapterId, content })
    )
  )

  // ---------- 设定集（Codex，含 RAG 索引钩子） ----------

  handle(IPC.CodexList, (projectId, type) => codex.list(projectId as string, type as string | undefined))
  handle(IPC.CodexCreate, (p) => {
    const entry = codex.create(p as CreateCodexPayload)
    void rag.indexCodexEntry(entry).catch(() => undefined)
    return entry
  })
  handle(IPC.CodexUpdate, (p) => {
    const entry = codex.update(p as UpdateCodexPayload)
    void rag.indexCodexEntry(entry).catch(() => undefined)
    return entry
  })
  handle(IPC.CodexDelete, (id) => {
    codex.delete(id as string)
    rag.removeCodexEntry(id as string)
  })

  // ---------- 大纲 ----------

  handle(IPC.OutlineGetBook, (projectId) => outline.getBook(projectId as string))
  handle(IPC.OutlineSaveBook, (p) => outline.saveBook(p as SaveBookOutlinePayload))
  handle(IPC.OutlineGetVolume, (volumeId) => outline.getVolume(volumeId as string))
  handle(IPC.OutlineSaveVolume, (p) => outline.saveVolume(p as SaveVolumeOutlinePayload))
  handle(IPC.OutlineGetChapter, (projectId, chapterNo) =>
    outline.getChapter(projectId as string, chapterNo as number)
  )
  handle(IPC.OutlineListChapters, (projectId) => outline.listChapters(projectId as string))
  handle(IPC.OutlineSaveChapter, (p) => outline.saveChapter(p as SaveChapterOutlinePayload))

  // ---------- 记忆与 RAG ----------

  handle(IPC.MemoryGetSummary, (projectId, chapterNo) =>
    memory.getSummary(projectId as string, chapterNo as number)
  )
  handle(IPC.MemorySaveSummary, (p) => memory.saveSummary(p as SaveSummaryPayload))
  handle(IPC.RagStatus, (projectId): RagStatusDTO => rag.getStatus(projectId as string))
  handle(IPC.RagRebuild, async (projectId) => {
    await rag.rebuildAll(projectId as string)
  })

  // ---------- 导出 ----------

  handle(IPC.ExportRun, async (p): Promise<{ ok: boolean; path?: string; error?: string }> => {
    const params = exportParamsSchema.parse(p as ExportParams)
    const title = services.getProjectTitle(params.projectId)
    if (!title) throw new Error('作品不存在')

    const chapters = services.exporter.getChapters(params.projectId, params.volumeId)
    if (chapters.length === 0) throw new Error('没有可导出的章节')

    const ext = params.format === 'txt' ? 'txt' : 'docx'
    const defaultName = `${ExportService.defaultFileName(title)}.${ext}`
    const filePath = await services.saveDialog(defaultName, ext)
    if (!filePath) return { ok: false, error: '已取消' }

    if (params.format === 'txt') {
      await services.exporter.exportTxt(title, chapters, filePath)
    } else {
      await services.exporter.exportDocx(title, chapters, filePath)
    }
    return { ok: true, path: filePath }
  })
}
