export interface TextChunk {
  text: string
  /** 命中的实体（角色名/别名/设定名），检索的关键词通道依赖此标注 */
  entities: string[]
}

const TARGET_MIN = 400
const TARGET_MAX = 800
const OVERLAP_MAX = 100

/**
 * 正文按场景切片：段落聚合成块（400~800 字），超长单段按句号硬切，
 * 块间保留 ≤100 字的上文重叠。每块标注命中的已知实体（名称/别名）。
 */
export function chunkText(text: string, knownEntities: string[] = []): TextChunk[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []

  // 1. 段落 -> 段组（空行分段，连续非空行聚为一个段落单元）
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, '').trim())
    .filter(Boolean)

  // 2. 超长段落按句边界硬切
  const units: string[] = []
  for (const p of paragraphs) {
    if (p.length <= TARGET_MAX) {
      units.push(p)
      continue
    }
    let rest = p
    while (rest.length > TARGET_MAX) {
      let cut = -1
      for (const sep of ['。', '！', '？', '…', '"']) {
        const idx = rest.lastIndexOf(sep, TARGET_MAX)
        if (idx > cut) cut = idx + sep.length
      }
      if (cut < TARGET_MIN) cut = TARGET_MAX
      units.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) units.push(rest)
  }

  // 3. 段组聚合成块
  const blocks: string[] = []
  let current = ''
  for (const unit of units) {
    if (current && current.length + unit.length > TARGET_MAX) {
      blocks.push(current)
      // 重叠：带上上一块末句（≤100 字），保证跨块指代不丢
      const tail = lastSentence(current)
      current = tail ? `${tail}${unit}` : unit
    } else {
      current = current ? `${current}${unit}` : unit
    }
    if (current.length >= TARGET_MIN) {
      blocks.push(current)
      const tail = lastSentence(current)
      current = tail && tail.length >= TARGET_MIN ? '' : tail
    }
  }
  if (current.trim()) blocks.push(current.trim())

  // 4. 实体标注
  const entities = [...new Set(knownEntities.map((e) => e.trim()).filter(Boolean))]
  return blocks
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => ({
      text: b,
      entities: entities.filter((name) => b.includes(name))
    }))
}

function lastSentence(block: string): string {
  let cut = -1
  for (const sep of ['。', '！', '？', '…']) {
    const idx = block.lastIndexOf(sep)
    if (idx > cut) cut = idx + sep.length
  }
  if (cut === -1) return ''
  const tail = block.slice(cut).trim()
  return tail.length <= OVERLAP_MAX ? tail : ''
}

/** 余弦相似度（向量等长，直接点积/模长） */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
