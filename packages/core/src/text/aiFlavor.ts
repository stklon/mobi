import {
  BANNED_PHRASES,
  SUMMARY_ENDING_PATTERNS,
  TRANSLATION_PATTERNS
} from './bannedWords'

export interface AiFlavorHit {
  rule: string
  detail: string
  suggestion: string
}

export interface AiFlavorReport {
  /** 0~100，越高 AI 味越重 */
  score: number
  level: 'clean' | 'mild' | 'heavy'
  hits: AiFlavorHit[]
  stats: { chars: number; sentences: number; avgSentenceLen: number; sentenceLenCV: number }
}

const SIMILE_WORDS = ['仿佛', '似乎', '宛如', '犹如', '如同']
const DIALOGUE_TAGS = ['说道', '说', '道', '问道', '答道', '笑道', '喊道', '开口']

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let idx = text.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = text.indexOf(needle, idx + needle.length)
  }
  return count
}

function cap(value: number, max: number): number {
  return Math.min(value, max)
}

/**
 * AI 味检测器（FR-DF-02）：纯本地规则引擎，不调用模型。
 * 七条规则见 docs/05-去AI味专项设计与需求.md；score = 加权和（上限 100）。
 */
export function detectAiFlavor(text: string): AiFlavorReport {
  const clean = text.replace(/\r\n/g, '\n').trim()
  const chars = clean.length
  const perKilo = chars > 0 ? 1000 / Math.max(chars, 1) : 0
  const hits: AiFlavorHit[] = []
  let score = 0

  // --- 句子统计 ---
  const sentences = clean
    .split(/[。！？…\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const lens = sentences.map((s) => s.length)
  const avg = lens.length > 0 ? lens.reduce((a, b) => a + b, 0) / lens.length : 0
  const variance = lens.length > 1 ? lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length : 0
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 0

  // --- R1 套话词 ---
  const phraseHits: string[] = []
  let phraseCount = 0
  for (const p of BANNED_PHRASES) {
    const n = countOccurrences(clean, p)
    if (n > 0) {
      phraseCount += n
      phraseHits.push(`${p}×${n}`)
    }
  }
  if (phraseCount > 0) {
    const density = phraseCount * perKilo
    score += cap(Math.round(density * 8), 40)
    hits.push({
      rule: 'R1 套话词',
      detail: phraseHits.slice(0, 10).join('、') + (phraseHits.length > 10 ? '…' : ''),
      suggestion: '替换为具体动作、神态或删除（如「眼眸一凛」→「他停住了筷子」）'
    })
  }

  // --- R2 比喻连接词密度 ---
  let simileCount = 0
  for (const w of SIMILE_WORDS) simileCount += countOccurrences(clean, w)
  const simileExcess = simileCount - 2 / perKilo
  if (simileExcess > 0.5) {
    score += cap(Math.round(simileExcess * 6 * perKilo || simileExcess * 6), 18)
    hits.push({
      rule: 'R2 比喻连接词过密',
      detail: `「${SIMILE_WORDS.join('/')}」共 ${simileCount} 次（每千字 ${Math.round(simileCount * perKilo)} 次）`,
      suggestion: '全文保留至多 1~2 处比喻，其余改为直陈'
    })
  }

  // --- R3 段末总结句 ---
  const paragraphs = clean.split(/\n+/).filter((p) => p.trim().length > 0)
  let endingHits = 0
  const endingSnippets: string[] = []
  for (const p of paragraphs) {
    const tail = p.trim().slice(-40)
    for (const re of SUMMARY_ENDING_PATTERNS) {
      if (re.test(tail)) {
        endingHits++
        endingSnippets.push(`「…${tail.slice(-20)}」`)
        break
      }
    }
  }
  if (endingHits > 0) {
    score += cap(endingHits * 10, 20)
    hits.push({
      rule: 'R3 段末总结句',
      detail: endingSnippets.join(' '),
      suggestion: '删除总结句，段末落在动作、对话或画面上'
    })
  }

  // --- R4 排比/相同开头 ---
  let repeatGroups = 0
  if (paragraphs.length >= 2) {
    let run = 1
    for (let i = 1; i < paragraphs.length; i++) {
      const a = paragraphs[i - 1].trim().slice(0, 4)
      const b = paragraphs[i].trim().slice(0, 4)
      if (a.length >= 4 && a === b) {
        run++
        if (run === 2) repeatGroups++
      } else {
        run = 1
      }
    }
  }
  if (/(他不知道[，,][\s\S]{0,40}他只知道|不是[\s\S]{0,20}而是[\s\S]{0,20}而是)/.test(clean)) {
    repeatGroups++
  }
  if (repeatGroups > 0) {
    score += cap(repeatGroups * 8, 16)
    hits.push({
      rule: 'R4 排比式开头',
      detail: `${repeatGroups} 组连续段落以相同字词开头`,
      suggestion: '拆掉排比，让各段起点错开'
    })
  }

  // --- R5 对话标签单一 ---
  const dialogueCount = countOccurrences(clean, '「') + countOccurrences(clean, '“') + countOccurrences(clean, '"')
  if (dialogueCount >= 5) {
    let tagTotal = 0
    let saidCount = 0
    for (const tag of DIALOGUE_TAGS) {
      const n = countOccurrences(clean, tag)
      tagTotal += n
      if (tag === '说道' || tag === '说' || tag === '道') saidCount += n
    }
    if (tagTotal > 0 && saidCount / tagTotal > 0.8) {
      score += 8
      hits.push({
        rule: 'R5 对话标签单一',
        detail: `说话动词八成以上是「说/道」`,
        suggestion: '改用动作衔接对话，或使用更具体的说话方式'
      })
    }
  }

  // --- R6 句长过匀（AI 节奏均匀） ---
  if (sentences.length >= 20 && cv < 0.35) {
    score += 10
    hits.push({
      rule: 'R6 句长过于均匀',
      detail: `变异系数 ${cv.toFixed(2)}（${sentences.length} 句，均长 ${avg.toFixed(0)} 字）`,
      suggestion: '长短句交错：把两个短句并成一长句，再插入一个 ≤6 字短句'
    })
  }

  // --- R7 翻译腔 ---
  let translationHits = 0
  const translationSnippets: string[] = []
  for (const re of TRANSLATION_PATTERNS) {
    const m = clean.match(re)
    if (m) {
      translationHits++
      if (translationSnippets.length < 4) translationSnippets.push(`「${m[0].slice(0, 12)}」`)
    }
  }
  if (translationHits > 0) {
    score += cap(translationHits * 4, 12)
    hits.push({
      rule: 'R7 翻译腔',
      detail: translationSnippets.join(' '),
      suggestion: '改为中文自然表达'
    })
  }

  score = Math.min(100, score)
  const level: AiFlavorReport['level'] = score < 30 ? 'clean' : score <= 60 ? 'mild' : 'heavy'
  return {
    score,
    level,
    hits,
    stats: {
      chars,
      sentences: sentences.length,
      avgSentenceLen: Math.round(avg * 10) / 10,
      sentenceLenCV: Math.round(cv * 100) / 100
    }
  }
}
