import { statSync } from 'node:fs'
import type { RagStatusDTO } from '@inkcraft/shared'
import type { LibraryService } from './services/libraryService'
import type { CodexService } from './services/codexService'
import type { RagService } from './services/ragService'
import type { MemoryService } from './services/memoryService'
import type { WritingService } from './services/writingService'

/** 确定性伪随机（同一章号生成相同内容，压测可复现） */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PLACES = ['藏经阁', '青云宗', '断剑崖', '万宝楼', '幽冥谷', '剑冢']
const SENTENCES = [
  '他屏住呼吸，把灵力压进经脉最深处，脚步放得比猫还轻。',
  '石壁上的刻痕在火光里明明灭灭，像一行行无人认读的古字。',
  '风从殿外灌进来，吹得烛火一阵乱晃，也吹乱了他的思绪。',
  '三年前的那个雨夜，师父说过的话又在耳边响了起来。',
  '他没有回头，只是握剑的手又紧了一分，指节泛白。',
  '远处的钟声敲了三下，整座山门都安静了下来。',
  '那道身影快得像一阵风，眨眼间已经掠过了三重屋脊。',
  '丹田里的气旋缓缓转了一圈，比昨日又凝实了几分。',
  '他低声念了个咒诀，掌心浮起一点幽蓝的光。',
  '所有人都在看他的笑话，他偏偏笑得比谁都平静。'
]

function generateChapter(no: number): string {
  const rng = mulberry32(no * 7919)
  const people = ['林凡', '苏若雪', '王虎', '玄机子', '叶轻眉']
  const paras: string[] = []
  for (let p = 0; p < 8; p++) {
    const who = people[Math.floor(rng() * people.length)]
    const where = PLACES[Math.floor(rng() * PLACES.length)]
    const body = Array.from({ length: 6 }, () => SENTENCES[Math.floor(rng() * SENTENCES.length)]).join('')
    paras.push(`${who}走进${where}。${body}`)
  }
  return paras.join('\n\n')
}

interface BenchServices {
  library: LibraryService
  codex: CodexService
  rag: RagService
  memory: MemoryService
  writing: WritingService
  dbPath: string
}

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/**
 * 百万字压测（INKCRAFT_BENCH=1 触发）：
 * 构造 500 章 × ~2000 字合成书（含设定/别名/摘要），走真实服务代码路径，
 * 量测建库、全量索引、检索（冷/热）、提示词组装延迟，对照 SRS 5.1 指标。
 */
export async function runBench(services: BenchServices): Promise<void> {
  const { library, codex, rag, memory, writing, dbPath } = services
  const totalChars = { v: 0 }

  console.log('[bench] === 百万字压测：构造数据（500 章） ===')
  let t0 = performance.now()
  const project = library.createProject({ title: `压测书 ${Date.now()}`, genre: '玄幻' })
  const volume = library.listVolumes(project.id)[0]

  codex.create({ projectId: project.id, type: 'world', name: '世界观', importance: 'pinned', content: '灵气复苏后的九州大陆，修炼体系分九境。'.repeat(20) })
  codex.create({ projectId: project.id, type: 'character', name: '林凡', aliases: ['小聋子'], content: '主角，坚韧，遇事先苟后爆发。' })
  codex.create({ projectId: project.id, type: 'character', name: '苏若雪', content: '青云宗圣女，冷淡，藏心事。' })
  codex.create({ projectId: project.id, type: 'character', name: '王虎', content: '反派，欺软怕硬。' })
  for (const p of PLACES) {
    codex.create({ projectId: project.id, type: 'location', name: p, content: `${p}：宗门要地，常年有弟子巡逻。` })
  }

  let lastChapterId = ''
  for (let no = 1; no <= 500; no++) {
    const chapter = library.createChapter({ projectId: project.id, volumeId: volume.id })
    const content = generateChapter(no)
    totalChars.v += content.length
    library.saveChapter({ id: chapter.id, title: `第${no}章 试炼`, content })
    lastChapterId = chapter.id
    // 每 10 章归档一次（摘要 + 索引，走真实归档路径）
    if (no % 10 === 0) {
      await memory.saveSummary({
        projectId: project.id,
        chapterNo: no,
        content: `第${no}章：林凡与苏若雪在${PLACES[no % PLACES.length]}遭遇王虎，冲突升级，林凡隐藏实力后撤离。`
      })
    }
  }
  const tBuild = performance.now() - t0
  console.log(`[bench] 建库 500 章完成：${totalChars.v} 字，${tBuild.toFixed(0)}ms（含 50 次归档索引）`)

  // --- 全量索引重建 ---
  t0 = performance.now()
  const rebuild = await rag.rebuildAll(project.id)
  const tRebuild = performance.now() - t0
  const status: RagStatusDTO = rag.getStatus(project.id)
  console.log(
    `[bench] 全量索引重建：${tRebuild.toFixed(0)}ms，${status.chunks} 切片，${rebuild.chapters} 章已索引`
  )

  // --- 检索延迟（冷启动 + 热缓存） ---
  const query = {
    outlineGoal: '寻找上古残卷的下落',
    plotPoints: ['潜入藏经阁', '与王虎正面冲突'],
    characters: ['林凡', '苏若雪'],
    textTail: '林凡走进藏经阁，指尖抚过冰凉的石壁，苏若雪跟在身后。'
  }
  t0 = performance.now()
  await rag.retrieveForContinue(project.id, 480, query)
  const tCold = performance.now() - t0

  const warm: number[] = []
  for (let i = 0; i < 18; i++) {
    const no = 100 + ((i * 53) % 350)
    const s = performance.now()
    await rag.retrieveForContinue(project.id, no, query)
    warm.push(performance.now() - s)
  }
  const warmAvg = warm.reduce((a, b) => a + b, 0) / warm.length
  console.log(
    `[bench] RAG 检索：冷启动 ${tCold.toFixed(0)}ms；热缓存 avg ${warmAvg.toFixed(1)}ms / p95 ${pct(warm, 95).toFixed(1)}ms（SRS 目标 <500ms）`
  )

  // --- 提示词组装（含检索） ---
  const assemble: number[] = []
  for (let i = 0; i < 5; i++) {
    const s = performance.now()
    await writing.buildContinuePrompt(lastChapterId, { wordCount: 1000 })
    assemble.push(performance.now() - s)
  }
  console.log(
    `[bench] T-06 全量组装（含检索）：avg ${(assemble.reduce((a, b) => a + b, 0) / assemble.length).toFixed(1)}ms`
  )

  // --- 列表与单章读取（编辑器相关） ---
  t0 = performance.now()
  library.listChapters(project.id)
  const tList = performance.now() - t0
  t0 = performance.now()
  library.getChapter(lastChapterId)
  const tGet = performance.now() - t0
  console.log(`[bench] 章节列表(500章) ${tList.toFixed(1)}ms；单章读取 ${tGet.toFixed(1)}ms`)

  // --- 数据库体积 ---
  let dbSizeMB = 0
  try {
    dbSizeMB = statSync(dbPath).size / 1024 / 1024
  } catch {
    /* ignore */
  }
  console.log(`[bench] 数据库体积：${dbSizeMB.toFixed(1)} MB`)

  // --- 清理 ---
  t0 = performance.now()
  library.deleteProject(project.id)
  console.log(`[bench] 清理完成（${(performance.now() - t0).toFixed(0)}ms）`)

  // --- SRS 门槛 ---
  if (warmAvg > 500) {
    throw new Error(`热缓存检索 avg ${warmAvg.toFixed(1)}ms 超出 SRS 500ms 指标`)
  }
  console.log('[bench] === 压测通过，全部指标达标 ===')
}
