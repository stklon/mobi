/**
 * 轻量模板渲染：{{var}} 变量替换 + {{#if var}}…{{/if}} 条件块（不支持嵌套）。
 * 变量为空/未定义时条件块整段省略，变量本身渲染为空串。
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | undefined | null>
): string {
  let out = template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, name: string, body: string) => {
      const v = vars[name]
      return v !== undefined && v !== null && String(v).trim() !== '' ? body : ''
    }
  )
  out = out.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const v = vars[name]
    return v === undefined || v === null ? '' : String(v)
  })
  return out
}

/** 提取模板中声明的变量名（保存模板时校验用） */
export function extractTemplateVariables(template: string): string[] {
  const names = new Set<string>()
  for (const m of template.matchAll(/\{\{#if (\w+)\}\}|\{\{(\w+)\}\}/g)) {
    names.add(m[1] ?? m[2])
  }
  return [...names]
}
