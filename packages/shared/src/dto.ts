export type ChapterStatus = 'draft' | 'generating' | 'done'

export interface ProjectDTO {
  id: string
  title: string
  genre: string
  targetWords: number
  styleGuide: string
  pov: string
  createdAt: number
  updatedAt: number
}

export interface CreateProjectPayload {
  title: string
  genre?: string
  targetWords?: number
  styleGuide?: string
  pov?: string
}

export interface UpdateProjectPayload {
  id: string
  title?: string
  genre?: string
  targetWords?: number
  styleGuide?: string
  pov?: string
}

export interface VolumeDTO {
  id: string
  projectId: string
  no: number
  title: string
  summary: string
  createdAt: number
  updatedAt: number
}

/** 章节列表项（不含正文，避免大结果集） */
export interface ChapterMetaDTO {
  id: string
  projectId: string
  volumeId: string
  no: number
  title: string
  wordCount: number
  status: ChapterStatus
  updatedAt: number
}

export interface ChapterDTO extends ChapterMetaDTO {
  content: string
}

export interface CreateChapterPayload {
  projectId: string
  volumeId: string
  title?: string
}

export interface SaveChapterPayload {
  id: string
  title?: string
  content?: string
}

export interface AppInfoDTO {
  version: string
  platform: string
  dbPath: string
}

// ---------- 模型 Provider 与设置 ----------

/** Provider 对外 DTO（绝不包含 API Key 明文/密文） */
export interface ProviderDTO {
  id: string
  name: string
  baseUrl: string
  hasKey: boolean
  models: string[]
}

export interface CreateProviderPayload {
  name: string
  baseUrl: string
  apiKey?: string
  /** 最近一次连通性测试拉到的模型列表（随保存写入） */
  models?: string[]
}

export interface UpdateProviderPayload {
  id: string
  name?: string
  baseUrl?: string
  /** 仅在修改 Key 时传入；留空表示不修改 */
  apiKey?: string
  models?: string[]
}

/** 功能场景：不同环节可用不同模型（成本/质量分工） */
export type ModelScene = 'genesis' | 'outline' | 'continue' | 'polish' | 'extract'

export interface SceneModelConfig {
  providerId: string
  model: string
}

export type ModelConfigDTO = Partial<Record<ModelScene, SceneModelConfig>>

export interface AppSettingsDTO {
  providers: ProviderDTO[]
  modelConfig: ModelConfigDTO
}

/** 连通性测试：传 id 用已存储配置；传 baseUrl/apiKey 测试未保存的表单 */
export interface ProviderTestPayload {
  id?: string
  baseUrl?: string
  apiKey?: string
}

export interface ProviderTestResult {
  ok: boolean
  models: string[]
  error?: string
}

// ---------- AI 生成 ----------

export type AiEvent =
  | { type: 'chunk'; requestId: string; text: string }
  | {
      type: 'finish'
      requestId: string
      usage: { promptTokens: number; completionTokens: number; estimated: boolean }
    }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; error: string }

export interface ContinueParams {
  chapterId: string
  /** 作者即时指令（如：本段写打斗，主角压着打） */
  directive?: string
  wordCount?: number
}

export type PolishOperation = 'polish' | 'rewrite' | 'expand' | 'shorten'

export interface PolishParams {
  chapterId: string
  selection: string
  operation: PolishOperation
  directive?: string
  /** 选区前的正文（供模型理解上下文，不会被改写） */
  contextBefore?: string
}

export interface AiStartResult {
  requestId: string
  /** 生成前的章节快照 id（用于回滚） */
  snapshotId?: string
}

// ---------- 快照 ----------

export type SnapshotKind = 'before_ai' | 'before_polish' | 'manual'

export interface SnapshotDTO {
  id: string
  chapterId: string
  kind: SnapshotKind
  title: string
  wordCount: number
  createdAt: number
}
