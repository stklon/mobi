import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { SaveSummaryPayload, SummaryDTO } from '@inkcraft/shared'
import { saveSummarySchema } from '@inkcraft/core'
import type { LibraryService } from './libraryService'
import type { OutlineService } from './outlineService'
import type { TemplateService } from './templateService'
import type { RagService } from './ragService'

interface SummaryRow {
  id: string
  project_id: string
  chapter_no: number
  level: string
  content: string
  created_at: number
  updated_at: number
}

const toDTO = (r: SummaryRow): SummaryDTO => ({
  id: r.id,
  projectId: r.project_id,
  chapterNo: r.chapter_no,
  level: r.level as SummaryDTO['level'],
  content: r.content,
  updatedAt: r.updated_at
})

export interface SummaryPromptResult {
  prompt: string
  templateCode: 'T-09'
  temperature: number
  maxTokens: number
}

/**
 * 记忆系统（M4 版）：章后摘要。
 * 摘要替代「原文尾巴」注入后续章节的续写提示词（token 减半，信息密度更高）；
 * 保存时同步写入 RAG 索引。卷摘要/角色状态快照/伏笔登记在 V1.x。
 */
export class MemoryService {
  constructor(
    private readonly db: Database,
    private readonly library: LibraryService,
    private readonly outline: OutlineService,
    private readonly templates: TemplateService,
    private readonly rag: RagService
  ) {}

  buildSummaryPrompt(chapterId: string): SummaryPromptResult {
    const chapter = this.library.getChapter(chapterId)
    if (!chapter) throw new Error('章节不存在')
    if (!chapter.content.trim()) throw new Error('本章还没有正文，先写点内容再归档')

    const project = this.library.getProject(chapter.projectId)
    if (!project) throw new Error('作品不存在')
    const outlineNode = this.outline.getChapter(project.id, chapter.no)

    const { prompt } = this.templates.render('T-09', {
      outlineGoal: outlineNode?.goal ?? '（无章纲）',
      chapterContent: chapter.content.slice(0, 12000)
    })
    return { prompt, templateCode: 'T-09', temperature: 0.5, maxTokens: 2048 }
  }

  getSummary(projectId: string, chapterNo: number): SummaryDTO | null {
    const row = this.db
      .prepare("SELECT * FROM summaries WHERE project_id = ? AND chapter_no = ? AND level = 'chapter'")
      .get(projectId, chapterNo) as SummaryRow | undefined
    return row ? toDTO(row) : null
  }

  /** 保存摘要（upsert）并触发该章正文 + 摘要的 RAG 索引 */
  async saveSummary(payload: SaveSummaryPayload): Promise<SummaryDTO> {
    const input = saveSummarySchema.parse(payload)
    if (!this.library.getProject(input.projectId)) throw new Error('作品不存在')

    const now = Date.now()
    const existing = this.getSummary(input.projectId, input.chapterNo)
    if (existing) {
      this.db
        .prepare('UPDATE summaries SET content = ?, updated_at = ? WHERE id = ?')
        .run(input.content, now, existing.id)
    } else {
      this.db
        .prepare(
          `INSERT INTO summaries (id, project_id, chapter_no, level, content, created_at, updated_at)
           VALUES (?, ?, ?, 'chapter', ?, ?, ?)`
        )
        .run(randomUUID(), input.projectId, input.chapterNo, input.content, now, now)
    }

    // 归档即索引：正文切片 + 摘要切片（失败不阻塞归档，可稍后手动重建）
    const chapter = this.findChapterByNo(input.projectId, input.chapterNo)
    if (chapter) {
      await this.rag.indexChapter(chapter.id).catch((err) => console.warn('[memory] 章节索引失败:', err))
    }
    await this.rag
      .indexSummary(input.projectId, input.chapterNo, input.content)
      .catch((err) => console.warn('[memory] 摘要索引失败:', err))

    return this.getSummary(input.projectId, input.chapterNo)!
  }

  listSummaries(projectId: string, chapterNos: number[]): Map<number, string> {
    const out = new Map<number, string>()
    if (chapterNos.length === 0) return out
    const placeholders = chapterNos.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT chapter_no, content FROM summaries
         WHERE project_id = ? AND level = 'chapter' AND chapter_no IN (${placeholders})`
      )
      .all(projectId, ...chapterNos) as Array<{ chapter_no: number; content: string }>
    for (const r of rows) out.set(r.chapter_no, r.content)
    return out
  }

  private findChapterByNo(projectId: string, chapterNo: number): { id: string } | null {
    const row = this.db
      .prepare('SELECT id FROM chapters WHERE project_id = ? AND no = ?')
      .get(projectId, chapterNo) as { id: string } | undefined
    return row ?? null
  }
}
