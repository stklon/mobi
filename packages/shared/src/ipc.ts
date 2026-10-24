import type {
  AppInfoDTO,
  AppSettingsDTO,
  ChapterDTO,
  ChapterMetaDTO,
  CreateChapterPayload,
  CreateProjectPayload,
  CreateProviderPayload,
  ModelConfigDTO,
  ProjectDTO,
  ProviderDTO,
  ProviderTestPayload,
  ProviderTestResult,
  SaveChapterPayload,
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
  ModelConfigSave: 'model-config:save'
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
}
