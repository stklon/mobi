import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  OutlineNodeDTO,
  SaveBookOutlinePayload,
  SaveChapterOutlinePayload,
  SaveVolumeOutlinePayload
} from '@inkcraft/shared'
import {
  saveBookOutlineSchema,
  saveChapterOutlineSchema,
  saveVolumeOutlineSchema
} from '@inkcraft/core'

interface OutlineRow {
  id: string
  project_id: string
  volume_id: string | null
  chapter_no: number | null
  level: string
  title: string
  content: string
  goal: string
  plot_points: string
  characters: string
  ending_hook: string
  status: string
  created_at: number
  updated_at: number
}

const toDTO = (r: OutlineRow): OutlineNodeDTO => ({
  id: r.id,
  projectId: r.project_id,
  volumeId: r.volume_id,
  chapterNo: r.chapter_no,
  level: r.level as OutlineNodeDTO['level'],
  title: r.title,
  content: r.content,
  goal: r.goal,
  plotPoints: JSON.parse(r.plot_points) as string[],
  characters: JSON.parse(r.characters) as string[],
  endingHook: r.ending_hook,
  status: r.status as OutlineNodeDTO['status'],
  updatedAt: r.updated_at
})

/**
 * 三层大纲服务：总纲（book，每书一条）/ 卷纲（volume，每卷一条）/ 章纲（chapter，按章号 upsert）。
 * 章纲是续写提示词的核心约束（T-06 的本章大纲区块）。
 */
export class OutlineService {
  constructor(
    private readonly db: Database,
    private readonly projectExists: (id: string) => boolean,
    private readonly volumeExists: (id: string) => boolean
  ) {}

  // ---------- 总纲 ----------

  getBook(projectId: string): OutlineNodeDTO | null {
    const row = this.db
      .prepare("SELECT * FROM outline_nodes WHERE project_id = ? AND level = 'book'")
      .get(projectId) as OutlineRow | undefined
    return row ? toDTO(row) : null
  }

  saveBook(payload: SaveBookOutlinePayload): OutlineNodeDTO {
    const input = saveBookOutlineSchema.parse(payload)
    if (!this.projectExists(input.projectId)) throw new Error('作品不存在')

    const now = Date.now()
    const existing = this.getBook(input.projectId)
    if (existing) {
      this.db
        .prepare('UPDATE outline_nodes SET title = ?, content = ?, updated_at = ? WHERE id = ?')
        .run(input.title ?? existing.title, input.content, now, existing.id)
      return this.getBook(input.projectId)!
    }
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO outline_nodes (id, project_id, level, title, content, created_at, updated_at)
         VALUES (?, ?, 'book', ?, ?, ?, ?)`
      )
      .run(id, input.projectId, input.title ?? '总纲', input.content, now, now)
    return this.getBook(input.projectId)!
  }

  // ---------- 卷纲 ----------

  getVolume(volumeId: string): OutlineNodeDTO | null {
    const row = this.db
      .prepare("SELECT * FROM outline_nodes WHERE volume_id = ? AND level = 'volume'")
      .get(volumeId) as OutlineRow | undefined
    return row ? toDTO(row) : null
  }

  saveVolume(payload: SaveVolumeOutlinePayload): OutlineNodeDTO {
    const input = saveVolumeOutlineSchema.parse(payload)
    if (!this.volumeExists(input.volumeId)) throw new Error('卷不存在')

    const now = Date.now()
    const existing = this.getVolume(input.volumeId)
    if (existing) {
      this.db
        .prepare('UPDATE outline_nodes SET title = ?, content = ?, updated_at = ? WHERE id = ?')
        .run(input.title ?? existing.title, input.content, now, existing.id)
      return this.getVolume(input.volumeId)!
    }
    const projectId = (this.db.prepare('SELECT project_id FROM volumes WHERE id = ?').get(input.volumeId) as { project_id: string }).project_id
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO outline_nodes (id, project_id, volume_id, level, title, content, created_at, updated_at)
         VALUES (?, ?, ?, 'volume', ?, ?, ?, ?)`
      )
      .run(id, projectId, input.volumeId, input.title ?? '卷纲', input.content, now, now)
    return this.getVolume(input.volumeId)!
  }

  // ---------- 章纲 ----------

  getChapter(projectId: string, chapterNo: number): OutlineNodeDTO | null {
    const row = this.db
      .prepare("SELECT * FROM outline_nodes WHERE project_id = ? AND level = 'chapter' AND chapter_no = ?")
      .get(projectId, chapterNo) as OutlineRow | undefined
    return row ? toDTO(row) : null
  }

  listChapters(projectId: string): OutlineNodeDTO[] {
    const rows = this.db
      .prepare("SELECT * FROM outline_nodes WHERE project_id = ? AND level = 'chapter' ORDER BY chapter_no")
      .all(projectId) as OutlineRow[]
    return rows.map(toDTO)
  }

  saveChapter(payload: SaveChapterOutlinePayload): OutlineNodeDTO {
    const input = saveChapterOutlineSchema.parse(payload)
    if (!this.projectExists(input.projectId)) throw new Error('作品不存在')
    if (!this.volumeExists(input.volumeId)) throw new Error('卷不存在')

    const existing = this.getChapter(input.projectId, input.chapterNo)
    const now = Date.now()
    if (existing) {
      this.db
        .prepare(
          `UPDATE outline_nodes SET volume_id = ?, title = ?, goal = ?, plot_points = ?, characters = ?,
              ending_hook = ?, status = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          input.volumeId,
          input.title ?? existing.title,
          input.goal ?? existing.goal,
          JSON.stringify(input.plotPoints ?? existing.plotPoints),
          JSON.stringify(input.characters ?? existing.characters),
          input.endingHook ?? existing.endingHook,
          input.status ?? existing.status,
          now,
          existing.id
        )
      return this.getChapter(input.projectId, input.chapterNo)!
    }

    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO outline_nodes (id, project_id, volume_id, chapter_no, level, title, goal, plot_points,
              characters, ending_hook, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'chapter', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.volumeId,
        input.chapterNo,
        input.title ?? `第${input.chapterNo}章`,
        input.goal ?? '',
        JSON.stringify(input.plotPoints ?? []),
        JSON.stringify(input.characters ?? []),
        input.endingHook ?? '',
        input.status ?? 'confirmed',
        now,
        now
      )
    return this.getChapter(input.projectId, input.chapterNo)!
  }

  deleteChapter(outlineId: string): void {
    const row = this.db.prepare('SELECT id FROM outline_nodes WHERE id = ?').get(outlineId)
    if (!row) throw new Error('章纲不存在')
    this.db.prepare('DELETE FROM outline_nodes WHERE id = ?').run(outlineId)
  }
}
