import type { Database } from 'better-sqlite3'
import type { ContinueParams, PolishOperation, PolishParams } from '@inkcraft/shared'
import { countWords } from '@inkcraft/core'
import { DEFAULT_BANNED_LIST } from '@inkcraft/core'
import type { LibraryService } from './libraryService'
import type { TemplateService } from './templateService'
import type { CodexService } from './codexService'
import type { OutlineService } from './outlineService'

interface PrevChapterRow {
  no: number
  title: string
  content: string
}

const TEXT_TAIL_CHARS = 2000
const PREV_TAIL_CHARS = 600
const PREV_CHAPTER_COUNT = 2

const WORLD_TOTAL_CAP = 3000
const WORLD_ENTRY_CAP = 1200
const CHARACTER_CARD_CAP = 800
const CHARACTER_MAX = 4

const OPERATION_LABELS: Record<PolishOperation, string> = {
  polish: '润色',
  rewrite: '改写',
  expand: '扩写',
  shorten: '缩写'
}

function tail(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(-max)
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export interface ContinuePromptResult {
  prompt: string
  templateCode: 'T-06'
  temperature: number
  maxTokens: number
}

export interface PolishPromptResult {
  prompt: string
  templateCode: 'T-07'
  temperature: number
  maxTokens: number
}

/**
 * 写作服务：为续写/润色构建上下文并渲染提示词。
 * M3 版上下文 = 书籍配置 + 世界观常驻卡（Codex pinned）+ 本章大纲（若有）
 *   + 出场角色档案（章纲声明，按名称/别名匹配 Codex）+ 前 2 章结尾 + 本章正文尾部。
 * M4 将接入 RAG 混合检索（相关前文/设定补充区块，见开发文档 7.4 预算表）。
 */
export class WritingService {
  constructor(
    private readonly db: Database,
    private readonly library: LibraryService,
    private readonly templates: TemplateService,
    private readonly codex: CodexService,
    private readonly outline: OutlineService
  ) {}

  buildContinuePrompt(chapterId: string, params: Omit<ContinueParams, 'chapterId'>): ContinuePromptResult {
    const chapter = this.library.getChapter(chapterId)
    if (!chapter) throw new Error('章节不存在')
    const project = this.library.getProject(chapter.projectId)
    if (!project) throw new Error('作品不存在')

    // --- 世界观常驻卡（pinned 条目，总长受控） ---
    let worldContext = this.codex
      .listPinned(project.id)
      .map((e) => `【${e.name}】\n${cap(e.content, WORLD_ENTRY_CAP)}`)
      .join('\n\n')
    worldContext = cap(worldContext, WORLD_TOTAL_CAP)

    // --- 本章大纲 + 出场角色档案 ---
    const outlineNode = this.outline.getChapter(project.id, chapter.no)
    let characterCards = ''
    let outlinePlotPoints = ''
    let outlineCharacters = ''
    if (outlineNode) {
      characterCards = this.codex
        .matchCharacters(project.id, outlineNode.characters)
        .slice(0, CHARACTER_MAX)
        .map(
          (e) =>
            `【${e.name}${e.aliases.length > 0 ? `（又称：${e.aliases.join('、')}）` : ''}】\n${cap(e.content, CHARACTER_CARD_CAP)}`
        )
        .join('\n\n')
      outlinePlotPoints = outlineNode.plotPoints.map((p) => `- ${p}`).join('\n')
      outlineCharacters = outlineNode.characters.join('、')
    }

    // --- 前文衔接 ---
    const prevRows = this.db
      .prepare(
        `SELECT no, title, content FROM chapters
         WHERE project_id = ? AND no < ? AND length(content) > 0
         ORDER BY no DESC LIMIT ?`
      )
      .all(project.id, chapter.no, PREV_CHAPTER_COUNT) as PrevChapterRow[]

    const prevContext = prevRows
      .reverse()
      .map((c) => `【第${c.no}章 ${c.title}】\n…${tail(c.content, PREV_TAIL_CHARS)}`)
      .join('\n\n')

    const wordCount = params.wordCount ?? 1000
    const vars = {
      genre: project.genre || '大众小说',
      styleGuide: project.styleGuide || '简洁有力，白描为主，以动作与细节驱动叙事',
      pov: project.pov || '第三人称单视角',
      bannedList: DEFAULT_BANNED_LIST,
      worldContext,
      characterCards,
      hasChapterOutline: outlineNode ? '1' : '',
      outlineGoal: outlineNode?.goal ?? '',
      outlinePlotPoints,
      outlineCharacters,
      outlineHook: outlineNode?.endingHook ?? '',
      prevContext,
      textTail: tail(chapter.content, TEXT_TAIL_CHARS) || '（本章还没有内容，请直接开篇）',
      wordCount,
      directive: params.directive ?? ''
    }

    const { prompt } = this.templates.render('T-06', vars)
    return {
      prompt,
      templateCode: 'T-06',
      temperature: 0.8,
      maxTokens: Math.min(Math.max(wordCount * 2, 1024), 8192)
    }
  }

  buildPolishPrompt(params: PolishParams): PolishPromptResult {
    const chapter = this.library.getChapter(params.chapterId)
    if (!chapter) throw new Error('章节不存在')
    const project = this.library.getProject(chapter.projectId)
    if (!project) throw new Error('作品不存在')

    const selection = params.selection.trim()
    if (!selection) throw new Error('选区为空')
    if (selection.length > 20_000) throw new Error('选区过长（>2 万字），请分批处理')

    const vars = {
      operationLabel: OPERATION_LABELS[params.operation],
      styleGuide: project.styleGuide || '简洁有力，白描为主，以动作与细节驱动叙事',
      bannedList: DEFAULT_BANNED_LIST,
      directive: params.directive ?? '',
      contextBefore: params.contextBefore ?? '',
      selection
    }

    const { prompt } = this.templates.render('T-07', vars)
    const baseWords = countWords(selection)
    return {
      prompt,
      templateCode: 'T-07',
      temperature: 0.7,
      maxTokens: Math.min(Math.max(baseWords * 4, 1024), 8192)
    }
  }
}
