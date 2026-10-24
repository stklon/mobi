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
  GenesisParams,
  ModelConfigDTO,
  OutlineBatchParams,
  PolishParams,
  ProviderTestPayload,
  SaveBookOutlinePayload,
  SaveChapterOutlinePayload,
  SaveChapterPayload,
  SaveVolumeOutlinePayload,
  SnapshotKind,
  UpdateCodexPayload,
  UpdateProjectPayload,
  UpdateProviderPayload
} from '@inkcraft/shared'
import {
  continueParamsSchema,
  genesisParamsSchema,
  outlineBatchParamsSchema,
  polishParamsSchema
} from '@inkcraft/core'
import type { LibraryService } from './services/libraryService'
import type { SettingService } from './services/settingService'
import type { SnapshotService } from './services/snapshotService'
import type { WritingService } from './services/writingService'
import type { AiOrchestrator } from './services/aiOrchestrator'
import type { CodexService } from './services/codexService'
import type { OutlineService } from './services/outlineService'
import type { GenesisService } from './services/genesisService'

export interface MainServices {
  library: LibraryService
  settings: SettingService
  writing: WritingService
  snapshots: SnapshotService
  orchestrator: AiOrchestrator
  codex: CodexService
  outline: OutlineService
  genesis: GenesisService
}

/**
 * 注册全部 IPC 通道。preload 侧的 InkcraftApi 与这里的参数/返回一一对应，
 * 契约以 packages/shared 的 IPC 常量为准。
 */
export function registerIpc(
  services: MainServices,
  meta: { version: string; dbPath: string }
): void {
  const { library, settings, writing, snapshots, orchestrator, codex, outline, genesis } = services

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

  handle(IPC.AIContinue, (p): AiStartResult => {
    const params = continueParamsSchema.parse(p)
    const built = writing.buildContinuePrompt(params.chapterId, params)
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

  // ---------- 设定集（Codex） ----------

  handle(IPC.CodexList, (projectId, type) => codex.list(projectId as string, type as string | undefined))
  handle(IPC.CodexCreate, (p) => codex.create(p as CreateCodexPayload))
  handle(IPC.CodexUpdate, (p) => codex.update(p as UpdateCodexPayload))
  handle(IPC.CodexDelete, (id) => codex.delete(id as string))

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
}
