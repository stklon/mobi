import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  CodexEntryDTO,
  CodexImportance,
  CodexType,
  CreateCodexPayload,
  UpdateCodexPayload
} from '@inkcraft/shared'
import { createCodexSchema, updateCodexSchema } from '@inkcraft/core'

interface CodexRow {
  id: string
  project_id: string
  type: string
  name: string
  aliases: string
  content: string
  importance: string
  created_at: number
  updated_at: number
}

const toDTO = (r: CodexRow): CodexEntryDTO => ({
  id: r.id,
  projectId: r.project_id,
  type: r.type as CodexType,
  name: r.name,
  aliases: JSON.parse(r.aliases) as string[],
  content: r.content,
  importance: r.importance as CodexImportance,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

/**
 * 设定集（Codex）服务：世界观/角色/地点等结构化设定。
 * importance=pinned 的条目在续写时常驻提示词（世界观压缩卡）；
 * 角色条目按 名称/别名 匹配章纲声明的出场角色注入角色档案。
 */
export class CodexService {
  constructor(
    private readonly db: Database,
    private readonly getProjectTitle: (id: string) => string | null
  ) {}

  list(projectId: string, type?: string): CodexEntryDTO[] {
    if (!this.getProjectTitle(projectId)) throw new Error('作品不存在')
    const rows = type
      ? (this.db
          .prepare('SELECT * FROM codex_entries WHERE project_id = ? AND type = ? ORDER BY updated_at DESC')
          .all(projectId, type) as CodexRow[])
      : (this.db
          .prepare('SELECT * FROM codex_entries WHERE project_id = ? ORDER BY updated_at DESC')
          .all(projectId) as CodexRow[])
    return rows.map(toDTO)
  }

  create(payload: CreateCodexPayload): CodexEntryDTO {
    const input = createCodexSchema.parse(payload)
    if (!this.getProjectTitle(input.projectId)) throw new Error('作品不存在')
    this.assertNameUnique(input.projectId, input.name)

    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO codex_entries (id, project_id, type, name, aliases, content, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.type,
        input.name,
        JSON.stringify(input.aliases ?? []),
        input.content ?? '',
        input.importance ?? 'retrieval',
        now,
        now
      )
    return this.getOrThrow(id)
  }

  update(payload: UpdateCodexPayload): CodexEntryDTO {
    const input = updateCodexSchema.parse(payload)
    const existing = this.getOrThrow(input.id)

    const merged = {
      type: input.type ?? existing.type,
      name: input.name ?? existing.name,
      aliases: input.aliases ?? existing.aliases,
      content: input.content ?? existing.content,
      importance: input.importance ?? existing.importance
    }
    if (merged.name !== existing.name) this.assertNameUnique(existing.projectId, merged.name)

    this.db
      .prepare(
        'UPDATE codex_entries SET type = ?, name = ?, aliases = ?, content = ?, importance = ?, updated_at = ? WHERE id = ?'
      )
      .run(merged.type, merged.name, JSON.stringify(merged.aliases), merged.content, merged.importance, Date.now(), input.id)
    return this.getOrThrow(input.id)
  }

  delete(codexId: string): void {
    this.getOrThrow(codexId)
    this.db.prepare('DELETE FROM codex_entries WHERE id = ?').run(codexId)
  }

  /** 常驻条目（续写提示词的世界观压缩卡来源） */
  listPinned(projectId: string): CodexEntryDTO[] {
    const rows = this.db
      .prepare("SELECT * FROM codex_entries WHERE project_id = ? AND importance = 'pinned' ORDER BY updated_at DESC")
      .all(projectId) as CodexRow[]
    return rows.map(toDTO)
  }

  /** 按名称/别名匹配角色条目（章纲声明的出场角色 -> 角色档案） */
  matchCharacters(projectId: string, names: string[]): CodexEntryDTO[] {
    if (names.length === 0) return []
    const wanted = new Set(names.map((n) => n.trim()).filter(Boolean))
    const rows = this.db
      .prepare("SELECT * FROM codex_entries WHERE project_id = ? AND type = 'character'")
      .all(projectId) as CodexRow[]
    return rows
      .map(toDTO)
      .filter((e) => wanted.has(e.name) || e.aliases.some((a) => wanted.has(a)))
  }

  private assertNameUnique(projectId: string, name: string): void {
    const row = this.db
      .prepare('SELECT id FROM codex_entries WHERE project_id = ? AND name = ?')
      .get(projectId, name)
    if (row) throw new Error(`已存在同名设定条目「${name}」`)
  }

  private getOrThrow(id: string): CodexEntryDTO {
    const row = this.db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(id) as CodexRow | undefined
    if (!row) throw new Error('设定条目不存在或已被删除')
    return toDTO(row)
  }
}
