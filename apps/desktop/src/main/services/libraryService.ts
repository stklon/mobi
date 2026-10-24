import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  ChapterDTO,
  ChapterMetaDTO,
  CreateChapterPayload,
  CreateProjectPayload,
  ProjectDTO,
  SaveChapterPayload,
  UpdateProjectPayload,
  VolumeDTO
} from '@inkcraft/shared'
import {
  countWords,
  createChapterSchema,
  createProjectSchema,
  saveChapterSchema,
  updateProjectSchema
} from '@inkcraft/core'

// ---------- 行类型 ----------

interface ProjectRow {
  id: string
  title: string
  genre: string
  target_words: number
  style_guide: string
  pov: string
  style_sample: string
  created_at: number
  updated_at: number
}

interface VolumeRow {
  id: string
  project_id: string
  no: number
  title: string
  summary: string
  created_at: number
  updated_at: number
}

interface ChapterRow {
  id: string
  project_id: string
  volume_id: string
  no: number
  title: string
  content: string
  word_count: number
  status: string
  updated_at: number
}

// ---------- 行 -> DTO ----------

const toProject = (r: ProjectRow): ProjectDTO => ({
  id: r.id,
  title: r.title,
  genre: r.genre,
  targetWords: r.target_words,
  styleGuide: r.style_guide,
  pov: r.pov,
  styleSample: r.style_sample ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toVolume = (r: VolumeRow): VolumeDTO => ({
  id: r.id,
  projectId: r.project_id,
  no: r.no,
  title: r.title,
  summary: r.summary,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toChapterMeta = (r: ChapterRow): ChapterMetaDTO => ({
  id: r.id,
  projectId: r.project_id,
  volumeId: r.volume_id,
  no: r.no,
  title: r.title,
  wordCount: r.word_count,
  status: r.status as ChapterMetaDTO['status'],
  updatedAt: r.updated_at
})

const toChapter = (r: ChapterRow): ChapterDTO => ({ ...toChapterMeta(r), content: r.content })

/**
 * 书架与章节的持久化服务（主进程，better-sqlite3 同步 API）。
 * 所有对外方法先经 zod 校验，再落库。
 */
export class LibraryService {
  constructor(private readonly db: Database) {}

  // ---------- 项目 ----------

  listProjects(): ProjectDTO[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as ProjectRow[]
    return rows.map(toProject)
  }

  createProject(payload: CreateProjectPayload): ProjectDTO {
    const input = createProjectSchema.parse(payload)
    const now = Date.now()
    const id = randomUUID()

    const insertProject = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, title, genre, target_words, style_guide, pov, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.title,
          input.genre ?? '',
          input.targetWords ?? 0,
          input.styleGuide ?? '',
          input.pov ?? '第三人称单视角',
          now,
          now
        )
      // 新书自动创建第一卷，作者开箱即可写第一章
      this.db
        .prepare(
          `INSERT INTO volumes (id, project_id, no, title, summary, created_at, updated_at)
           VALUES (?, ?, 1, '第一卷', '', ?, ?)`
        )
        .run(randomUUID(), id, now, now)
    })
    insertProject()

    return this.getProjectOrThrow(id)
  }

  updateProject(payload: UpdateProjectPayload): ProjectDTO {
    const input = updateProjectSchema.parse(payload)
    const existing = this.getProjectOrThrow(input.id)

    const merged = {
      title: input.title ?? existing.title,
      genre: input.genre ?? existing.genre,
      targetWords: input.targetWords ?? existing.targetWords,
      styleGuide: input.styleGuide ?? existing.styleGuide,
      pov: input.pov ?? existing.pov,
      styleSample: input.styleSample ?? existing.styleSample
    }
    this.db
      .prepare(
        'UPDATE projects SET title = ?, genre = ?, target_words = ?, style_guide = ?, pov = ?, style_sample = ?, updated_at = ? WHERE id = ?'
      )
      .run(merged.title, merged.genre, merged.targetWords, merged.styleGuide, merged.pov, merged.styleSample, Date.now(), input.id)

    return this.getProjectOrThrow(input.id)
  }

  deleteProject(projectId: string): void {
    this.getProjectOrThrow(projectId)
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }

  getProject(id: string): ProjectDTO | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
    return row ? toProject(row) : null
  }

  private getProjectOrThrow(id: string): ProjectDTO {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
    if (!row) throw new Error('作品不存在或已被删除')
    return toProject(row)
  }

  // ---------- 卷 ----------

  listVolumes(projectId: string): VolumeDTO[] {
    const rows = this.db
      .prepare('SELECT * FROM volumes WHERE project_id = ? ORDER BY no')
      .all(projectId) as VolumeRow[]
    return rows.map(toVolume)
  }

  getVolume(id: string): VolumeDTO | null {
    const row = this.db.prepare('SELECT * FROM volumes WHERE id = ?').get(id) as VolumeRow | undefined
    return row ? toVolume(row) : null
  }

  createVolume(projectId: string, title: string): VolumeDTO {
    this.getProjectOrThrow(projectId)
    const t = title.trim()
    if (!t) throw new Error('卷名不能为空')

    const now = Date.now()
    const id = randomUUID()
    const nextNo = (this.db
      .prepare('SELECT COALESCE(MAX(no), 0) + 1 AS n FROM volumes WHERE project_id = ?')
      .get(projectId) as { n: number }).n

    this.db
      .prepare(
        `INSERT INTO volumes (id, project_id, no, title, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?)`
      )
      .run(id, projectId, nextNo, t, now, now)

    const row = this.db.prepare('SELECT * FROM volumes WHERE id = ?').get(id) as VolumeRow
    return toVolume(row)
  }

  // ---------- 章节 ----------

  listChapters(projectId: string): ChapterMetaDTO[] {
    const rows = this.db
      .prepare(
        'SELECT id, project_id, volume_id, no, title, word_count, status, updated_at FROM chapters WHERE project_id = ? ORDER BY no'
      )
      .all(projectId) as ChapterRow[]
    return rows.map(toChapterMeta)
  }

  getChapter(chapterId: string): ChapterDTO | null {
    const row = this.db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as ChapterRow | undefined
    return row ? toChapter(row) : null
  }

  createChapter(payload: CreateChapterPayload): ChapterDTO {
    const input = createChapterSchema.parse(payload)
    this.getProjectOrThrow(input.projectId)
    const volume = this.db
      .prepare('SELECT * FROM volumes WHERE id = ? AND project_id = ?')
      .get(input.volumeId, input.projectId) as VolumeRow | undefined
    if (!volume) throw new Error('卷不存在或不属于该作品')

    // 章号在全书范围内连续递增（检索邻近性依赖此字段）
    const no = (this.db
      .prepare('SELECT COALESCE(MAX(no), 0) + 1 AS n FROM chapters WHERE project_id = ?')
      .get(input.projectId) as { n: number }).n

    const now = Date.now()
    const id = randomUUID()
    const title = input.title?.trim() || `第${no}章`

    this.db
      .prepare(
        `INSERT INTO chapters (id, project_id, volume_id, no, title, content, word_count, status, updated_at)
         VALUES (?, ?, ?, ?, ?, '', 0, 'draft', ?)`
      )
      .run(id, input.projectId, input.volumeId, no, title, now)

    return this.getChapterOrThrow(id)
  }

  saveChapter(payload: SaveChapterPayload): ChapterDTO {
    const input = saveChapterSchema.parse(payload)
    const existing = this.getChapterOrThrow(input.id)

    const title = input.title?.trim() || existing.title
    const content = input.content ?? existing.content
    const wordCount = countWords(content)

    this.db
      .prepare('UPDATE chapters SET title = ?, content = ?, word_count = ?, updated_at = ? WHERE id = ?')
      .run(title, content, wordCount, Date.now(), input.id)

    return this.getChapterOrThrow(input.id)
  }

  private getChapterOrThrow(id: string): ChapterDTO {
    const row = this.db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as ChapterRow | undefined
    if (!row) throw new Error('章节不存在或已被删除')
    return toChapter(row)
  }
}
