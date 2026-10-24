import type { Database } from 'better-sqlite3'
import { BUILTIN_TEMPLATES, extractTemplateVariables, renderTemplate } from '@inkcraft/core'

interface TemplateRow {
  code: string
  name: string
  content: string
  variables: string
  is_builtin: number
}

/**
 * 内置模板入库（upsert）：每次启动同步为最新内置内容。
 * 目前没有模板编辑 UI，所有行都是内置态；M2 收尾做模板中心时，
 * 需引入 user_modified 标记，仅更新未被用户修改的行。
 */
export function seedTemplates(db: Database): void {
  const upsert = db.prepare(
    `INSERT INTO prompt_templates (code, name, content, variables, is_builtin, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        content = excluded.content,
        variables = excluded.variables,
        updated_at = excluded.updated_at`
  )
  for (const t of BUILTIN_TEMPLATES) {
    upsert.run(t.code, t.name, t.content, JSON.stringify(extractTemplateVariables(t.content)), Date.now())
  }
}

/** 模板服务：读取 + 渲染（M2 只读；模板中心编辑 UI 在 M3） */
export class TemplateService {
  constructor(private readonly db: Database) {}

  get(code: string): TemplateRow {
    const row = this.db.prepare('SELECT * FROM prompt_templates WHERE code = ?').get(code) as
      | TemplateRow
      | undefined
    if (!row) throw new Error(`提示词模板 ${code} 不存在`)
    return row
  }

  render(code: string, vars: Record<string, string | number | undefined | null>): { prompt: string; templateName: string } {
    const row = this.get(code)
    return { prompt: renderTemplate(row.content, vars), templateName: row.name }
  }
}
