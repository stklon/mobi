import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { CodexEntryDTO, RagContextChunkDTO, RagStatusDTO } from '@inkcraft/shared'
import { chunkText, cosineSimilarity } from '@inkcraft/core'
import type { EmbeddingClient } from './embeddingClient'
import type { LibraryService } from './libraryService'
import type { CodexService } from './codexService'

interface ChunkRow {
  id: string
  project_id: string
  source_type: string
  source_id: string
  chapter_no: number | null
  text: string
  entities: string
  embedding: Buffer | null
  embedding_model: string | null
}

export interface ContinueQuery {
  outlineGoal: string
  plotPoints: string[]
  characters: string[]
  textTail: string
}

const RAG_TOP_N = 4
const RAG_TOTAL_CAP = 1500
/** 距当前章太近的内容已在前文记忆区块，不重复检索 */
const RECENT_SKIP = 3

/**
 * RAG 服务：切片 + 嵌入 + 混合检索。
 *
 * 工程决策（对照开发文档 7 章）：
 * - 向量存 Float32 BLOB、JS 暴力余弦——10 万字 ≈ 200 chunk，全扫 <10ms；
 *   避免引入 sqlite-vec 原生扩展（其分发渠道在本网络不可达）。量大后再换。
 * - 关键词通道用「实体标注交集」而非 FTS5：中文角色名多为 2 字，FTS5 trigram
 *   需 ≥3 字无法命中；chunk 建索引时已做实体标注，效果等价且可测。
 * - 嵌入未配置/失败时自动降级为纯实体检索，功能不中断。
 */
export class RagService {
  private cache = new Map<string, { rows: ChunkRow[]; loadedAt: number }>()

  constructor(
    private readonly db: Database,
    private readonly embedding: EmbeddingClient,
    private readonly library: LibraryService,
    private readonly codex: CodexService
  ) {}

  // ---------- 索引 ----------

  /** 章后归档时调用：正文切片入库（含嵌入），并替换该章旧切片 */
  async indexChapter(chapterId: string): Promise<number> {
    const chapter = this.library.getChapter(chapterId)
    if (!chapter) throw new Error('章节不存在')
    if (!chapter.content.trim()) return 0

    const entities = this.allEntityNames(chapter.projectId)
    const chunks = chunkText(chapter.content, entities)
    await this.writeChunks(chapter.projectId, 'chapter_text', chapter.id, chapter.no, chunks)
    return chunks.length
  }

  /** Codex 条目创建/更新后调用（每条目一片） */
  async indexCodexEntry(entry: CodexEntryDTO): Promise<void> {
    if (!entry.content.trim()) {
      this.deleteBySource('codex', entry.id)
      return
    }
    await this.writeChunks(entry.projectId, 'codex', entry.id, null, [
      { text: entry.content.slice(0, 2000), entities: [entry.name, ...entry.aliases] }
    ])
  }

  /** 章摘要保存后调用：摘要作为一片入库（信息密度高，检索优先） */
  async indexSummary(projectId: string, chapterNo: number, content: string): Promise<void> {
    if (!content.trim()) return
    await this.writeChunks(projectId, 'summary', `chapter-${chapterNo}`, chapterNo, [
      { text: content.slice(0, 1200), entities: this.entitiesInText(projectId, content) }
    ])
  }

  async rebuildAll(projectId: string): Promise<{ chapters: number; codex: number }> {
    this.db.prepare('DELETE FROM chunks WHERE project_id = ?').run(projectId)
    this.cache.delete(projectId)

    const chapters = this.library.listChapters(projectId)
    let chapterCount = 0
    for (const meta of chapters) {
      const n = await this.indexChapter(meta.id)
      if (n > 0) chapterCount++
    }
    const entries = this.codex.list(projectId)
    for (const e of entries) await this.indexCodexEntry(e)
    return { chapters: chapterCount, codex: entries.length }
  }

  getStatus(projectId: string): RagStatusDTO {
    const rows = this.loadRows(projectId)
    return {
      chunks: rows.length,
      embedded: rows.filter((r) => r.embedding !== null).length,
      embeddingConfigured: this.embedding.isConfigured()
    }
  }

  /** Codex 条目删除后调用 */
  removeCodexEntry(entryId: string): void {
    this.deleteBySource('codex', entryId)
  }

  // ---------- 检索 ----------

  /**
   * 续写场景检索：混合得分 = 0.6*向量 + 0.4*实体命中（无向量时纯实体），
   * 章节邻近 +0.1，远章正文按 0.6^(Δ/50) 衰减；跳过最近 3 章（前文记忆已覆盖）。
   */
  async retrieveForContinue(
    projectId: string,
    currentChapterNo: number,
    query: ContinueQuery
  ): Promise<RagContextChunkDTO[]> {
    const rows = this.loadRows(projectId)
    if (rows.length === 0) return []

    // 查询实体：章纲角色 + 正文尾部命中的实体名
    const queryEntities = new Set(
      [...query.characters, ...this.entitiesInText(projectId, query.textTail)].map((s) => s.trim()).filter(Boolean)
    )

    // 候选：跳过最近章节的正文/摘要；跳过 pinned 世界观（已在常驻区块）
    const pinnedIds = new Set(this.codex.listPinned(projectId).map((e) => e.id))
    const candidates = rows.filter((r) => {
      if (r.source_type === 'codex') return !pinnedIds.has(r.source_id)
      if (r.chapter_no === null) return true
      return currentChapterNo - r.chapter_no > RECENT_SKIP
    })
    if (candidates.length === 0) return []

    // 向量通道
    let queryVec: number[] | null = null
    if (this.embedding.isConfigured() && candidates.some((c) => c.embedding !== null)) {
      const queryText = [query.outlineGoal, ...query.plotPoints, ...query.characters].join('；').slice(0, 600)
      try {
        const vecs = await this.embedding.embed([queryText])
        queryVec = vecs?.[0] ?? null
      } catch (err) {
        console.warn('[rag] 向量检索降级为实体检索:', err instanceof Error ? err.message : err)
      }
    }

    const scored = candidates.map((r) => {
      const entities = JSON.parse(r.entities) as string[]
      const hits = entities.filter((e) => queryEntities.has(e)).length
      const keywordScore = queryEntities.size > 0 ? hits / queryEntities.size : 0

      let vectorScore = 0
      if (queryVec && r.embedding && r.embedding.length > 0) {
        const vec = Array.from(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4))
        if (vec.length === queryVec.length) vectorScore = cosineSimilarity(queryVec, vec)
      }

      let score = queryVec ? 0.6 * vectorScore + 0.4 * keywordScore : keywordScore

      if (r.source_type === 'summary') score += 0.05
      if (r.chapter_no !== null) {
        const delta = currentChapterNo - r.chapter_no
        if (delta <= 15) score += 0.1
        if (r.source_type === 'chapter_text') score *= Math.pow(0.6, delta / 50)
      }
      return { row: r, score }
    })

    scored.sort((a, b) => b.score - a.score)

    // 组装（总长受控，逐块丢弃超限的低分块）
    const out: RagContextChunkDTO[] = []
    let used = 0
    for (const s of scored) {
      if (out.length >= RAG_TOP_N) break
      if (s.score <= 0) break
      const text = s.row.text.slice(0, 600)
      if (used + text.length > RAG_TOTAL_CAP) continue
      used += text.length
      out.push({
        text,
        sourceType: s.row.source_type as RagContextChunkDTO['sourceType'],
        label: this.labelOf(s.row),
        score: Math.round(s.score * 100) / 100
      })
    }
    return out
  }

  /** 供 T-06 组装：格式化为提示词区块文本 */
  formatContext(chunks: RagContextChunkDTO[]): string {
    return chunks.map((c) => `【${c.label}】${c.text}`).join('\n\n')
  }

  private labelOf(r: ChunkRow): string {
    if (r.source_type === 'summary') return `第${r.chapter_no}章摘要`
    if (r.source_type === 'codex') {
      const name = this.db.prepare('SELECT name FROM codex_entries WHERE id = ?').get(r.source_id) as
        | { name: string }
        | undefined
      return `设定 · ${name?.name ?? '未命名'}`
    }
    return `第${r.chapter_no}章 · 情节`
  }

  // ---------- 内部 ----------

  private async writeChunks(
    projectId: string,
    sourceType: string,
    sourceId: string,
    chapterNo: number | null,
    chunks: { text: string; entities: string[] }[]
  ): Promise<void> {
    this.deleteBySource(sourceType, sourceId)

    let embeddings: number[][] | null = null
    if (this.embedding.isConfigured() && chunks.length > 0) {
      try {
        embeddings = await this.embedding.embed(chunks.map((c) => c.text))
      } catch (err) {
        console.warn(`[rag] 嵌入失败（${sourceType}，稍后可重建索引）:`, err instanceof Error ? err.message : err)
      }
    }
    const modelName = this.embedding.getModelName() ?? ''

    const insert = this.db.prepare(
      `INSERT INTO chunks (id, project_id, source_type, source_id, chapter_no, text, entities, embedding, embedding_model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const now = Date.now()
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      const vec = embeddings?.[i]
      const buf = vec ? Buffer.from(new Float32Array(vec).buffer) : null
      insert.run(
        randomUUID(),
        projectId,
        sourceType,
        sourceId,
        chapterNo,
        c.text,
        JSON.stringify(c.entities),
        buf,
        buf ? modelName : null,
        now
      )
    }
    this.cache.delete(projectId)
  }

  private deleteBySource(sourceType: string, sourceId: string): void {
    const info = this.db
      .prepare('SELECT project_id FROM chunks WHERE source_type = ? AND source_id = ? LIMIT 1')
      .get(sourceType, sourceId) as { project_id: string } | undefined
    this.db.prepare('DELETE FROM chunks WHERE source_type = ? AND source_id = ?').run(sourceType, sourceId)
    if (info) this.cache.delete(info.project_id)
  }

  private loadRows(projectId: string): ChunkRow[] {
    const cached = this.cache.get(projectId)
    if (cached) return cached.rows
    const rows = this.db
      .prepare('SELECT * FROM chunks WHERE project_id = ?')
      .all(projectId) as ChunkRow[]
    this.cache.set(projectId, { rows, loadedAt: Date.now() })
    return rows
  }

  private allEntityNames(projectId: string): string[] {
    const entries = this.codex.list(projectId)
    return entries.flatMap((e) => [e.name, ...e.aliases])
  }

  private entitiesInText(projectId: string, text: string): string[] {
    if (!text) return []
    return this.allEntityNames(projectId).filter((name) => text.includes(name))
  }
}
