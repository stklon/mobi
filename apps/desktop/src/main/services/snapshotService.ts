import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { ChapterDTO, SnapshotDTO, SnapshotKind } from '@inkcraft/shared'
import { countWords } from '@inkcraft/core'

interface SnapshotRow {
  id: string
  chapter_id: string
  kind: string
  title: string
  content: string
  created_at: number
}

const MAX_SNAPSHOTS_PER_CHAPTER = 200

const toDTO = (r: SnapshotRow): SnapshotDTO => ({
  id: r.id,
  chapterId: r.chapter_id,
  kind: r.kind as SnapshotKind,
  title: r.title,
  wordCount: countWords(r.content),
  createdAt: r.created_at
})

/**
 * 章节版本快照。M2 为简化采用全量存储（每章上限 200 个，超出裁最旧的）；
 * 后续可换增量 diff（开发文档 5 章 snapshots 表设计预留了 diff 字段方案）。
 */
export class SnapshotService {
  constructor(
    private readonly db: Database,
    private readonly getChapter: (id: string) => ChapterDTO | null
  ) {}

  create(chapterId: string, kind: SnapshotKind, title: string): SnapshotDTO {
    const chapter = this.getChapter(chapterId)
    if (!chapter) throw new Error('章节不存在')

    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        'INSERT INTO snapshots (id, chapter_id, kind, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, chapterId, kind, title, chapter.content, now)

    this.pruneOld(chapterId)
    const row = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as SnapshotRow
    return toDTO(row)
  }

  list(chapterId: string): SnapshotDTO[] {
    const rows = this.db
      .prepare('SELECT * FROM snapshots WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(chapterId) as SnapshotRow[]
    return rows.map(toDTO)
  }

  /** 恢复快照：把快照内容写回章节并返回最新章节（渲染层同步编辑器） */
  restore(snapshotId: string, saveChapter: (id: string, content: string) => ChapterDTO): ChapterDTO {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId) as
      | SnapshotRow
      | undefined
    if (!row) throw new Error('快照不存在')
    return saveChapter(row.chapter_id, row.content)
  }

  /** 恢复前可选：预览快照内容 */
  getContent(snapshotId: string): { chapterId: string; content: string; title: string } | null {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId) as
      | SnapshotRow
      | undefined
    if (!row) return null
    return { chapterId: row.chapter_id, content: row.content, title: row.title }
  }

  private pruneOld(chapterId: string): void {
    const count = (this.db
      .prepare('SELECT COUNT(*) AS c FROM snapshots WHERE chapter_id = ?')
      .get(chapterId) as { c: number }).c
    if (count > MAX_SNAPSHOTS_PER_CHAPTER) {
      this.db
        .prepare(
          `DELETE FROM snapshots WHERE chapter_id = ? AND id IN (
             SELECT id FROM snapshots WHERE chapter_id = ? ORDER BY created_at ASC LIMIT ?
           )`
        )
        .run(chapterId, chapterId, count - MAX_SNAPSHOTS_PER_CHAPTER)
    }
  }
}
