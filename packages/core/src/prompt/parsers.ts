import type { ParsedChapterOutlineDTO } from '@inkcraft/shared'

/**
 * 解析 T-02 角色生成结果：按「### 角色名」标题切分为独立角色卡。
 * 解析失败（无 ### 标题）返回空数组，调用方降级为整块保存。
 */
export function parseCharacterCards(md: string): { name: string; content: string }[] {
  const sections: { name: string; content: string }[] = []
  let current: { name: string; content: string } | null = null

  for (const line of md.split('\n')) {
    const m = line.match(/^#{2,4}\s+(.+)$/)
    if (m) {
      if (current && current.name) sections.push(current)
      current = { name: m[1].trim(), content: '' }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current && current.name) sections.push(current)

  return sections
    .map((s) => ({ name: s.name, content: s.content.trim() }))
    .filter((s) => s.name.length > 0 && s.name.length <= 50)
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
}

/**
 * 解析 T-05 批量章纲的 JSON 输出。
 * 宽松处理：剥掉 ``` 代码围栏，截取首个 [ 到最后一个 ]，字段级校验后过滤无效项。
 */
export function parseOutlineBatch(text: string): ParsedChapterOutlineDTO[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: ParsedChapterOutlineDTO[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const no = Number(o.no)
    const goal = typeof o.goal === 'string' ? o.goal.trim() : ''
    if (!Number.isInteger(no) || no < 1 || !goal) continue
    out.push({
      no,
      title: typeof o.title === 'string' ? o.title.trim().slice(0, 100) : `第${no}章`,
      goal,
      plotPoints: toStringArray(o.plotPoints).slice(0, 10),
      characters: toStringArray(o.characters).slice(0, 10),
      endingHook: typeof o.endingHook === 'string' ? o.endingHook.trim().slice(0, 300) : ''
    })
  }
  return out.sort((a, b) => a.no - b.no)
}
