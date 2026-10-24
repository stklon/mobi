export type ChapterStatus = 'draft' | 'generating' | 'done'

export interface ProjectDTO {
  id: string
  title: string
  genre: string
  targetWords: number
  styleGuide: string
  pov: string
  /** 文风样本（作者自己写的 500~8000 字，续写时注入以锚定个人文风，去 AI 味核心手段） */
  styleSample: string
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
  styleSample?: string
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
  /** 接口协议：openai = /chat/completions；anthropic = /v1/messages（GLM Coding Plan / Claude 系） */
  protocol: 'openai' | 'anthropic'
  hasKey: boolean
  models: string[]
}

export interface CreateProviderPayload {
  name: string
  baseUrl: string
  protocol?: 'openai' | 'anthropic'
  apiKey?: string
  /** 最近一次连通性测试拉到的模型列表（随保存写入） */
  models?: string[]
}

export interface UpdateProviderPayload {
  id: string
  name?: string
  baseUrl?: string
  protocol?: 'openai' | 'anthropic'
  /** 仅在修改 Key 时传入；留空表示不修改 */
  apiKey?: string
  models?: string[]
}

/** 功能场景：不同环节可用不同模型（成本/质量分工）；embedding 走 /embeddings 接口 */
export type ModelScene = 'genesis' | 'outline' | 'continue' | 'polish' | 'extract' | 'embedding'

export interface SceneModelConfig {
  providerId: string
  model: string
}

export type ModelConfigDTO = Partial<Record<ModelScene, SceneModelConfig>>

export interface AppSettingsDTO {
  providers: ProviderDTO[]
  modelConfig: ModelConfigDTO
}

/** 连通性测试：传 id 用已存储配置；传 baseUrl/apiKey 测试未保存的表单（表单测试需带 protocol） */
export interface ProviderTestPayload {
  id?: string
  baseUrl?: string
  apiKey?: string
  protocol?: 'openai' | 'anthropic'
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

export type PolishOperation = 'polish' | 'rewrite' | 'expand' | 'shorten' | 'deai'

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

// ---------- 设定集（Codex） ----------

export type CodexType = 'world' | 'character' | 'location' | 'faction' | 'item' | 'rule' | 'custom'
export type CodexImportance = 'pinned' | 'retrieval'

export interface CodexEntryDTO {
  id: string
  projectId: string
  type: CodexType
  name: string
  /** 别名/曾用名/称号（供角色匹配与后续 RAG 关键词召回） */
  aliases: string[]
  content: string
  importance: CodexImportance
  createdAt: number
  updatedAt: number
}

export interface CreateCodexPayload {
  projectId: string
  type: CodexType
  name: string
  aliases?: string[]
  content?: string
  importance?: CodexImportance
}

export interface UpdateCodexPayload {
  id: string
  type?: CodexType
  name?: string
  aliases?: string[]
  content?: string
  importance?: CodexImportance
}

// ---------- 大纲 ----------

export type OutlineLevel = 'book' | 'volume' | 'chapter'
export type OutlineStatus = 'pending' | 'confirmed'

export interface OutlineNodeDTO {
  id: string
  projectId: string
  volumeId: string | null
  /** chapter 级关联的全书连续章号 */
  chapterNo: number | null
  level: OutlineLevel
  title: string
  /** book/volume 级的自由 Markdown 正文 */
  content: string
  /** chapter 级结构化字段 */
  goal: string
  plotPoints: string[]
  characters: string[]
  endingHook: string
  status: OutlineStatus
  updatedAt: number
}

export interface SaveBookOutlinePayload {
  projectId: string
  title?: string
  content: string
}

export interface SaveVolumeOutlinePayload {
  volumeId: string
  title?: string
  content: string
}

export interface SaveChapterOutlinePayload {
  projectId: string
  volumeId: string
  chapterNo: number
  title?: string
  goal?: string
  plotPoints?: string[]
  characters?: string[]
  endingHook?: string
  status?: OutlineStatus
}

// ---------- 创世向导与批量章纲 ----------

export type GenesisStep = 'world' | 'characters' | 'outline'

export interface GenesisInput {
  idea: string
  styleKeywords: string
  hasGoldenFinger: boolean
  characterCount?: number
  theme?: string
  /** step=characters 时无需；step=outline 时由前两步产出回填 */
  worldContent?: string
  charactersContent?: string
}

export interface GenesisParams {
  projectId: string
  step: GenesisStep
  input: GenesisInput
}

export interface OutlineBatchParams {
  projectId: string
  volumeId: string
  startNo: number
  count: number
}

/** T-05 批量章纲的解析结果（渲染层确认后入库） */
export interface ParsedChapterOutlineDTO {
  no: number
  title: string
  goal: string
  plotPoints: string[]
  characters: string[]
  endingHook: string
}

// ---------- 记忆系统（章后摘要） ----------

export interface SummaryDTO {
  id: string
  projectId: string
  chapterNo: number
  level: 'chapter' | 'volume'
  content: string
  updatedAt: number
}

export interface SaveSummaryPayload {
  projectId: string
  chapterNo: number
  content: string
}

// ---------- RAG ----------

export interface RagStatusDTO {
  chunks: number
  embedded: number
  embeddingConfigured: boolean
}

export interface RagContextChunkDTO {
  text: string
  sourceType: 'codex' | 'chapter_text' | 'summary'
  label: string
  score: number
}

// ---------- 导出 ----------

export type ExportFormat = 'txt' | 'docx'

export interface ExportParams {
  projectId: string
  format: ExportFormat
  /** 不传 = 全书；传则只导该卷 */
  volumeId?: string
}

export interface ExportResult {
  ok: boolean
  path?: string
  error?: string
}
