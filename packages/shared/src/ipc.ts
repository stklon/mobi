import type {
  AiEvent,
  AiStartResult,
  AppInfoDTO,
  AppSettingsDTO,
  ChapterDTO,
  ChapterMetaDTO,
  ContinueParams,
  CreateChapterPayload,
  CreateCodexPayload,
  CodexEntryDTO,
  CreateProjectPayload,
  CreateProviderPayload,
  ExportParams,
  ExportResult,
  GenesisParams,
  ModelConfigDTO,
  OutlineBatchParams,
  OutlineNodeDTO,
  PolishParams,
  ProjectDTO,
  ProviderDTO,
  ProviderTestPayload,
  ProviderTestResult,
  RagStatusDTO,
  SaveBookOutlinePayload,
  SaveChapterOutlinePayload,
  SaveChapterPayload,
  SaveSummaryPayload,
  SaveVolumeOutlinePayload,
  SnapshotDTO,
  SnapshotKind,
  SummaryDTO,
  UpdateCodexPayload,
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
  AIGenesis: 'ai:genesis',
  AIOutlineBatch: 'ai:outline-batch',
  SnapshotList: 'snapshot:list',
  SnapshotCreate: 'snapshot:create',
  SnapshotRestore: 'snapshot:restore',
  CodexList: 'codex:list',
  CodexCreate: 'codex:create',
  CodexUpdate: 'codex:update',
  CodexDelete: 'codex:delete',
  OutlineGetBook: 'outline:get-book',
  OutlineSaveBook: 'outline:save-book',
  OutlineGetVolume: 'outline:get-volume',
  OutlineSaveVolume: 'outline:save-volume',
  OutlineGetChapter: 'outline:get-chapter',
  OutlineListChapters: 'outline:list-chapters',
  OutlineSaveChapter: 'outline:save-chapter',
  AISummarize: 'ai:summarize',
  MemoryGetSummary: 'memory:get-summary',
  MemorySaveSummary: 'memory:save-summary',
  RagStatus: 'rag:status',
  RagRebuild: 'rag:rebuild',
  ExportRun: 'export:run'
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
  aiGenesis(params: GenesisParams): Promise<AiStartResult>
  aiOutlineBatch(params: OutlineBatchParams): Promise<AiStartResult>
  snapshotList(chapterId: string): Promise<SnapshotDTO[]>
  snapshotCreate(chapterId: string, kind: SnapshotKind, title: string): Promise<SnapshotDTO>
  snapshotRestore(snapshotId: string): Promise<ChapterDTO>
  codexList(projectId: string, type?: string): Promise<CodexEntryDTO[]>
  codexCreate(payload: CreateCodexPayload): Promise<CodexEntryDTO>
  codexUpdate(payload: UpdateCodexPayload): Promise<CodexEntryDTO>
  codexDelete(codexId: string): Promise<void>
  outlineGetBook(projectId: string): Promise<OutlineNodeDTO | null>
  outlineSaveBook(payload: SaveBookOutlinePayload): Promise<OutlineNodeDTO>
  outlineGetVolume(volumeId: string): Promise<OutlineNodeDTO | null>
  outlineSaveVolume(payload: SaveVolumeOutlinePayload): Promise<OutlineNodeDTO>
  outlineGetChapter(projectId: string, chapterNo: number): Promise<OutlineNodeDTO | null>
  outlineListChapters(projectId: string): Promise<OutlineNodeDTO[]>
  outlineSaveChapter(payload: SaveChapterOutlinePayload): Promise<OutlineNodeDTO>
  aiSummarize(params: { chapterId: string }): Promise<AiStartResult>
  memoryGetSummary(projectId: string, chapterNo: number): Promise<SummaryDTO | null>
  memorySaveSummary(payload: SaveSummaryPayload): Promise<SummaryDTO>
  ragStatus(projectId: string): Promise<RagStatusDTO>
  ragRebuild(projectId: string): Promise<void>
  exportRun(params: ExportParams): Promise<ExportResult>
}
