import type { Database } from 'better-sqlite3'
import { BUILTIN_TEMPLATES, extractTemplateVariables, renderTemplate } from '@inkcraft/core'

interface TemplateRow {
  code: string
  name: string
  content: string
  variables: string
  is_builtin: number
}

/** 内置模板入库（幂等）：只补缺失的 code，不覆盖用户后续的修改 */
export function seedTemplates(db: Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO prompt_templates (code, name, content, variables, is_builtin, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  )
  for (const t of BUILTIN_TEMPLATES) {
    insert.run(t.code, t.name, t.content, JSON.stringify(extractTemplateVariables(t.content)), Date.now())
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
