import type { AiEvent, ModelConfigDTO } from '@inkcraft/shared'
import { parseOutlineBatch } from '@inkcraft/core'
import type { LibraryService } from './services/libraryService'
import type { SettingService } from './services/settingService'
import type { CodexService } from './services/codexService'
import type { OutlineService } from './services/outlineService'
import type { GenesisService } from './services/genesisService'
import type { WritingService } from './services/writingService'
import type { MemoryService } from './services/memoryService'
import type { AiOrchestrator } from './services/aiOrchestrator'
import type { EmbeddingClient } from './services/embeddingClient'
import type { RagService } from './services/ragService'

export interface E2EOptions {
  /** 使用已存在的 Provider（用户已在设置页配置好 Key） */
  providerName?: string
  /** 从环境创建 Provider（mock 测试用） */
  baseUrl?: string
  apiKey?: string
  protocol?: 'openai' | 'anthropic'
  createName?: string
  models?: string[]
  /** 嵌入模型（如百炼 text-embedding-v4）；设置后测试 RAG 向量通道 */
  embedModel?: string
  /** 测完保留临时 Provider 与场景配置（用户开箱即用）；默认清理还原 */
  keep?: boolean
}

interface E2EServices {
  library: LibraryService
  settings: SettingService
  codex: CodexService
  outline: OutlineService
  genesis: GenesisService
  writing: WritingService
  memory: MemoryService
  embedding: EmbeddingClient
  rag: RagService
  /** 每个任务一个独立编排器实例，便于捕获事件 */
  makeOrchestrator: (emit: (e: AiEvent) => void) => AiOrchestrator
}

interface GenSpec {
  scene: 'continue' | 'polish' | 'extract' | 'outline' | 'genesis'
  prompt: string
  templateCode: string
  temperature: number
  maxTokens: number
}

interface RunResult {
  name: string
  ok: boolean
  firstTokenMs?: number
  totalMs?: number
  chars?: number
  usage?: string
  full: string
  error?: string
}

async function runGeneration(services: E2EServices, job: GenSpec): Promise<RunResult> {
  const events: AiEvent[] = []
  const started = performance.now()
  let firstTokenMs: number | undefined

  const orchestrator = services.makeOrchestrator((e) => {
    if (e.type === 'chunk' && firstTokenMs === undefined) firstTokenMs = performance.now() - started
    events.push(e)
  })
  orchestrator.enqueue({
    requestId: `e2e-${job.scene}-${Date.now()}`,
    scene: job.scene,
    prompt: job.prompt,
    templateCode: job.templateCode,
    temperature: job.temperature,
    maxTokens: job.maxTokens
  })
  await orchestrator.drain()

  const error = events.find((e): e is Extract<AiEvent, { type: 'error' }> => e.type === 'error')
  const finish = events.find((e): e is Extract<AiEvent, { type: 'finish' }> => e.type === 'finish')
  const full = events
    .filter((e): e is Extract<AiEvent, { type: 'chunk' }> => e.type === 'chunk')
    .map((e) => e.text)
    .join('')

  return {
    name: `${job.scene}/${job.templateCode}`,
    ok: !error && full.length > 0,
    firstTokenMs: firstTokenMs !== undefined ? Math.round(firstTokenMs) : undefined,
    totalMs: Math.round(performance.now() - started),
    chars: full.length,
    usage: finish
      ? `${finish.usage.promptTokens}/${finish.usage.completionTokens} tokens${finish.usage.estimated ? '（估）' : ''}`
      : undefined,
    full,
    error: error?.error
  }
}

/**
 * 真实端到端测试（INKCRAFT_E2E=1）：
 * 走完整的提示词构建 → 编排器 → 流式返回链路（续写/润色/摘要/批量章纲）。
 * - providerName：用已配置的 Provider 实测真实模型（结束后恢复原场景配置）；
 * - baseUrl 等环境变量：创建临时 Provider（配合 scripts/mock-llm-server.mjs 无 Key 验证）。
 */
export async function runE2E(services: E2EServices, opts: E2EOptions): Promise<void> {
  const { library, settings, codex, outline, genesis, writing, memory } = services

  let createdProviderId: string | undefined
  let prevModelConfig: ModelConfigDTO | null = null
  let testProjectId: string | undefined
  const results: RunResult[] = []

  try {
    // ---- Provider 解析 ----
    const s0 = settings.getSettings()
    let providerId: string
    let models: string[]

    if (opts.providerName) {
      const found = s0.providers.find((p) => p.name === opts.providerName)
      if (!found) throw new Error(`找不到 Provider「${opts.providerName}」，请先在应用设置中配置`)
      providerId = found.id
      models = found.models.length > 0 ? found.models : (opts.models ?? [])
      console.log(`[e2e] 使用已配置 Provider：${found.name}（${found.protocol}，${found.hasKey ? '有 Key' : '无 Key'}）`)
    } else {
      if (!opts.baseUrl) throw new Error('缺少 INKCRAFT_E2E_BASE_URL')
      const existing = s0.providers.find((p) => p.name === (opts.createName ?? 'E2E Provider'))
      if (existing) settings.deleteProvider(existing.id)
      const created = settings.createProvider({
        name: opts.createName ?? 'E2E Provider',
        baseUrl: opts.baseUrl,
        protocol: opts.protocol ?? 'openai',
        apiKey: opts.apiKey ?? '',
        models: opts.models ?? []
      })
      createdProviderId = created.id
      providerId = created.id
      models = created.models
      console.log(`[e2e] 已创建临时 Provider：${created.name}（${created.protocol}）`)
    }

    if (models.length === 0) throw new Error('模型列表为空：请提供 INKCRAFT_E2E_MODELS 或先在设置页测试连接拉取')
    const model = models[0]
    console.log(`[e2e] 使用模型：${model}`)

    // 场景配置（记录原值，结束后恢复）
    prevModelConfig = settings.getSettings().modelConfig
    const testConfig: ModelConfigDTO = {}
    for (const scene of ['genesis', 'outline', 'continue', 'polish', 'extract'] as const) {
      testConfig[scene] = { providerId, model }
    }
    settings.saveModelConfig(testConfig)

    // ---- 连通性 ----
    const testRes = await settings.testProvider({ id: providerId })
    console.log(`[e2e] 连通性：${testRes.ok ? 'OK' : 'FAIL'} ${testRes.error ?? ''}（模型 ${testRes.models.length} 个）`)

    // ---- 测试书 ----
    const project = library.createProject({ title: `E2E 测试书 ${Date.now()}`, genre: '玄幻' })
    testProjectId = project.id
    const volume = library.listVolumes(project.id)[0]
    codex.create({ projectId: project.id, type: 'world', name: '世界观', importance: 'pinned', content: '灵气复苏后的九州大陆，修炼分九境，禁术会反噬。' })
    codex.create({ projectId: project.id, type: 'character', name: '林凡', aliases: ['小聋子'], content: '主角，坚韧，遇事先苟后爆发，持断剑。' })
    codex.create({ projectId: project.id, type: 'character', name: '苏若雪', content: '青云宗圣女，冷淡，暗中关注林凡。' })
    outline.saveBook({ projectId: project.id, content: '废柴少年逆天改命，三年内杀回宗门。' })
    outline.saveChapter({
      projectId: project.id, volumeId: volume.id, chapterNo: 1,
      goal: '林凡重生醒来，藏起锋芒', plotPoints: ['确认重生', '发现断剑异动'],
      characters: ['小聋子'], endingHook: '仇人王虎上门'
    })
    outline.saveChapter({
      projectId: project.id, volumeId: volume.id, chapterNo: 2,
      goal: '夜探藏经阁寻残卷', plotPoints: ['翻墙入阁', '遭遇黑影'],
      characters: ['林凡', '苏若雪'], endingHook: '黑影摘下斗笠'
    })
    const ch1 = library.createChapter({ projectId: project.id, volumeId: volume.id })
    library.saveChapter({
      id: ch1.id, title: '第一章 醒来',
      content: '林凡睁开眼，回到了十八岁那年。窗外蝉鸣刺耳，床头压着半柄断剑。\n\n王虎的脚步声由远及近。他缓缓握住剑柄，把翻涌的记忆压回心底——这一世，不会再退了。'
    })
    const ch2 = library.createChapter({ projectId: project.id, volumeId: volume.id })
    library.saveChapter({
      id: ch2.id, title: '第二章 夜探',
      content: '子时的钟声敲过三巡。林凡换上夜行衣，绕开巡夜弟子，朝藏经阁摸去。'
    })

    // ---- 四类生成任务 ----
    console.log('[e2e] 生成任务测试开始…')
    const cont = await writing.buildContinuePrompt(ch2.id, { wordCount: 500 })
    results.push(await runGeneration(services, { scene: 'continue', prompt: cont.prompt, templateCode: cont.templateCode, temperature: cont.temperature, maxTokens: cont.maxTokens }))

    const pol = writing.buildPolishPrompt({ chapterId: ch1.id, selection: '王虎的脚步声由远及近。他缓缓握住剑柄。', operation: 'polish' })
    results.push(await runGeneration(services, { scene: 'polish', prompt: pol.prompt, templateCode: pol.templateCode, temperature: pol.temperature, maxTokens: pol.maxTokens }))

    const sum = memory.buildSummaryPrompt(ch1.id)
    results.push(await runGeneration(services, { scene: 'extract', prompt: sum.prompt, templateCode: sum.templateCode, temperature: sum.temperature, maxTokens: sum.maxTokens }))

    const batch = genesis.buildOutlineBatchPrompt({ projectId: project.id, volumeId: volume.id, startNo: 3, count: 2 })
    const batchRes = await runGeneration(services, { scene: 'outline', prompt: batch.prompt, templateCode: batch.templateCode, temperature: batch.temperature, maxTokens: batch.maxTokens })
    results.push(batchRes)

    // 批量章纲需可解析为结构化章纲
    const parsed = parseOutlineBatch(batchRes.full)
    const parseOk = parsed.length > 0
    console.log(`[e2e] 章纲 JSON 解析：${parseOk ? `OK（${parsed.length} 条）` : 'FAIL'}`)
    if (!parseOk) batchRes.ok = false

    // ---- 嵌入通道（RAG 向量检索） ----
    if (opts.embedModel) {
      console.log(`[e2e] 嵌入通道测试（模型 ${opts.embedModel}）…`)
      settings.saveModelConfig({ ...testConfig, embedding: { providerId, model: opts.embedModel } })
      const t = performance.now()
      const vecs = await services.embedding.embed(['林凡走进藏经阁，翻开上古残卷。'])
      const embedMs = Math.round(performance.now() - t)
      if (!vecs || vecs.length !== 1 || vecs[0].length === 0) throw new Error('嵌入调用失败')
      console.log(`[e2e] 嵌入调用 OK：${embedMs}ms，维度 ${vecs[0].length}`)

      const chunkCount = await services.rag.indexChapter(ch2.id)
      const status = services.rag.getStatus(project.id)
      console.log(`[e2e] 章节索引：${chunkCount} 切片；全书 ${status.chunks} 片，已嵌入 ${status.embedded} 片`)
      if (status.embedded === 0) throw new Error('索引后嵌入数仍为 0（向量通道未生效）')

      // 用较远的章号检索（近 3 章内容被设计性跳过，避免与前文记忆区块重复）
      const hits = await services.rag.retrieveForContinue(project.id, 10, {
        outlineGoal: '寻找上古残卷的下落',
        plotPoints: ['潜入藏经阁', '遭遇黑影'],
        characters: ['林凡'],
        textTail: '林凡朝藏经阁摸去。'
      })
      console.log(
        `[e2e] 向量+实体混合检索：命中 ${hits.length} 块${hits.length > 0 ? `（top: ${hits[0].label} 得分 ${hits[0].score}）` : ''}`
      )
      if (hits.length === 0) throw new Error('混合检索无命中')
    }

    // ---- 汇总 ----
    console.log('\n[e2e] ===== 结果汇总 =====')
    for (const r of results) {
      const status = r.ok ? 'OK  ' : 'FAIL'
      console.log(
        `[${status}] ${r.name}  首字 ${r.firstTokenMs ?? '-'}ms  总 ${r.totalMs}ms  ${r.chars ?? 0}字  ${r.usage ?? ''}${r.error ? '  错误: ' + r.error : ''}`
      )
      console.log(`       预览: ${r.full.slice(0, 60)}`)
    }

    const failures = results.filter((r) => !r.ok)
    if (failures.length > 0) throw new Error(`${failures.length} 项生成任务失败`)
    console.log('[e2e] ===== 全部通过 =====')
  } finally {
    // ---- 清理：恢复场景配置，删除临时 Provider 与测试书（keep 模式保留 Provider 与配置） ----
    try {
      if (!opts.keep) {
        if (prevModelConfig) settings.saveModelConfig(prevModelConfig)
        if (createdProviderId) settings.deleteProvider(createdProviderId)
      }
      if (testProjectId) library.deleteProject(testProjectId)
    } catch (err) {
      console.warn('[e2e] 清理失败:', err)
    }
  }
}
