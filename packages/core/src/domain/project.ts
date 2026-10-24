import { z } from 'zod'

/** 内置题材列表（创世向导/书架筛选用，后续可由题材模板扩展） */
export const GENRES = ['玄幻', '都市', '悬疑', '科幻', '历史', '仙侠', '游戏', '轻小说', '其他'] as const
export type Genre = (typeof GENRES)[number]

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, '书名不能为空').max(60, '书名不能超过 60 字'),
  genre: z.string().trim().max(30).optional(),
  targetWords: z.number().int().min(0).max(10_000_000).optional(),
  styleGuide: z.string().max(2000).optional(),
  pov: z.string().max(50).optional()
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>

export const updateProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, '书名不能为空').max(60).optional(),
  genre: z.string().trim().max(30).optional(),
  targetWords: z.number().int().min(0).max(10_000_000).optional(),
  styleGuide: z.string().max(2000).optional(),
  pov: z.string().max(50).optional()
})

export const createChapterSchema = z.object({
  projectId: z.string().min(1),
  volumeId: z.string().min(1),
  title: z.string().trim().max(100).optional()
})

export const saveChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().max(100).optional(),
  content: z.string().max(1_000_000).optional()
})

// ---------- 模型 Provider ----------

const baseUrlSchema = z
  .string()
  .trim()
  .regex(/^https?:\/\/\S+/, 'Base URL 需以 http(s):// 开头')

export const createProviderSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(50),
  baseUrl: baseUrlSchema,
  apiKey: z.string().max(500).optional(),
  models: z.array(z.string().min(1)).max(1000).optional()
})

export const updateProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '名称不能为空').max(50).optional(),
  baseUrl: baseUrlSchema.optional(),
  apiKey: z.string().max(500).optional(),
  models: z.array(z.string().min(1)).max(1000).optional()
})

export const modelConfigSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1)
})

export const continueParamsSchema = z.object({
  chapterId: z.string().min(1),
  directive: z.string().max(2000).optional(),
  wordCount: z.number().int().min(100).max(6000).optional()
})

export const polishParamsSchema = z.object({
  chapterId: z.string().min(1),
  selection: z.string().min(1).max(20000),
  operation: z.enum(['polish', 'rewrite', 'expand', 'shorten']),
  directive: z.string().max(2000).optional(),
  contextBefore: z.string().max(3000).optional()
})

// ---------- 设定集（Codex） ----------

export const CODEX_TYPES = ['world', 'character', 'location', 'faction', 'item', 'rule', 'custom'] as const

export const createCodexSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(CODEX_TYPES),
  name: z.string().trim().min(1, '名称不能为空').max(50),
  aliases: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  content: z.string().max(20000).optional(),
  importance: z.enum(['pinned', 'retrieval']).optional()
})

export const updateCodexSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CODEX_TYPES).optional(),
  name: z.string().trim().min(1, '名称不能为空').max(50).optional(),
  aliases: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  content: z.string().max(20000).optional(),
  importance: z.enum(['pinned', 'retrieval']).optional()
})

// ---------- 大纲 ----------

export const saveBookOutlineSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().max(100).optional(),
  content: z.string().max(50000)
})

export const saveVolumeOutlineSchema = z.object({
  volumeId: z.string().min(1),
  title: z.string().trim().max(100).optional(),
  content: z.string().max(50000)
})

export const saveChapterOutlineSchema = z.object({
  projectId: z.string().min(1),
  volumeId: z.string().min(1),
  chapterNo: z.number().int().min(1).max(100000),
  title: z.string().trim().max(100).optional(),
  goal: z.string().max(2000).optional(),
  plotPoints: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  characters: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  endingHook: z.string().max(500).optional(),
  status: z.enum(['pending', 'confirmed']).optional()
})

// ---------- 创世与批量章纲 ----------

export const genesisParamsSchema = z.object({
  projectId: z.string().min(1),
  step: z.enum(['world', 'characters', 'outline']),
  input: z.object({
    idea: z.string().trim().min(1, '请先填写核心创意').max(3000),
    styleKeywords: z.string().max(200).optional().default(''),
    hasGoldenFinger: z.boolean().optional().default(false),
    characterCount: z.number().int().min(1).max(8).optional(),
    theme: z.string().max(100).optional(),
    worldContent: z.string().max(30000).optional(),
    charactersContent: z.string().max(30000).optional()
  })
})

export const outlineBatchParamsSchema = z.object({
  projectId: z.string().min(1),
  volumeId: z.string().min(1),
  startNo: z.number().int().min(1).max(100000),
  count: z.number().int().min(1).max(30)
})
