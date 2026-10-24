import type {
  AiEvent,
  AiStartResult,
  AppInfoDTO,
  AppSettingsDTO,
  ChapterDTO,
  ChapterMetaDTO,
  ContinueParams,
  CreateChapterPayload,
  CreateProjectPayload,
  CreateProviderPayload,
  ModelConfigDTO,
  PolishParams,
  ProjectDTO,
  ProviderDTO,
  ProviderTestPayload,
  ProviderTestResult,
  SaveChapterPayload,
  SnapshotDTO,
  SnapshotKind,
  UpdateProjectPayload,
  UpdateProviderPayload,
  VolumeDTO
} from './dto'

/** IPC 通道名常量与 preload 暴露的 API 契约（单一事实来源） */
export const IPC = {
  AppInfo: 'app:info',
  ProjectList: 'project:list',
  ProjectCreate: 'project:create',
  ProjectUpdate: 'project:update',
  ProjectDelete: 'project:delete',
  VolumeList: 'volume:list',
  VolumeCreate: 'volume:create',
  ChapterList: 'chapter:list',
  ChapterGet: 'chapter:get',
  ChapterCreate: 'chapter:create',
  ChapterSave: 'chapter:save',
  SettingsGet: 'settings:get',
  ProviderCreate: 'provider:create',
  ProviderUpdate: 'provider:update',
  ProviderDelete: 'provider:delete',
  ProviderTest: 'provider:test',
  ModelConfigSave: 'model-config:save',
  AIContinue: 'ai:continue',
  AIPolish: 'ai:polish',
  AICancel: 'ai:cancel',
  AIEvent: 'ai:event',
  SnapshotList: 'snapshot:list',
  SnapshotCreate: 'snapshot:create',
  SnapshotRestore: 'snapshot:restore'
} as const

export interface InkcraftApi {
  appInfo(): Promise<AppInfoDTO>
  projectList(): Promise<ProjectDTO[]>
  projectCreate(payload: CreateProjectPayload): Promise<ProjectDTO>
  projectUpdate(payload: UpdateProjectPayload): Promise<ProjectDTO>
  projectDelete(projectId: string): Promise<void>
  volumeList(projectId: string): Promise<VolumeDTO[]>
  volumeCreate(projectId: string, title: string): Promise<VolumeDTO>
  chapterList(projectId: string): Promise<ChapterMetaDTO[]>
  chapterGet(chapterId: string): Promise<ChapterDTO | null>
  chapterCreate(payload: CreateChapterPayload): Promise<ChapterDTO>
  chapterSave(payload: SaveChapterPayload): Promise<ChapterDTO>
  getSettings(): Promise<AppSettingsDTO>
  providerCreate(payload: CreateProviderPayload): Promise<ProviderDTO>
  providerUpdate(payload: UpdateProviderPayload): Promise<ProviderDTO>
  providerDelete(providerId: string): Promise<void>
  providerTest(payload: ProviderTestPayload): Promise<ProviderTestResult>
  saveModelConfig(config: ModelConfigDTO): Promise<ModelConfigDTO>
  aiContinue(params: ContinueParams): Promise<AiStartResult>
  aiPolish(params: PolishParams): Promise<AiStartResult>
  aiCancel(requestId: string): Promise<void>
  /** 全局 AI 事件流（渲染层挂载时订阅，按 requestId 过滤，避免 invoke 后才订阅丢事件） */
  onAiEvent(cb: (event: AiEvent) => void): () => void
  snapshotList(chapterId: string): Promise<SnapshotDTO[]>
  snapshotCreate(chapterId: string, kind: SnapshotKind, title: string): Promise<SnapshotDTO>
  snapshotRestore(snapshotId: string): Promise<ChapterDTO>
}
