import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { AiEvent, ModelScene } from '@inkcraft/shared'
import { estimateTokens } from '@inkcraft/core'
import type { SettingService } from './settingService'

export interface GenerateJob {
  requestId: string
  scene: ModelScene
  prompt: string
  templateCode?: string
  temperature: number
  maxTokens: number
}

interface ModelContext {
  providerId: string
  model: string
  baseUrl: string
  apiKey: string
  protocol: 'openai' | 'anthropic'
}

/** 可重试错误（连接失败/限流/5xx，发生在拿到响应体之前）；其余为致命错误直接失败 */
class RetryableError extends Error {}

const CONNECT_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 3
const RETRY_DELAYS = [1_000, 3_000]

/**
 * AI 编排器：OpenAI 兼容 chat/completions 流式调用。
 * - 全局串行队列（单用户桌面应用，保证上下文一致性）
 * - 首字节 30s 超时；连接类错误重试 2 次；流一旦开始，中断即失败（已收内容保留在编辑器，不整单重试）
 * - 每次调用写 ai_logs；token 为估算值（不强依赖 SSE usage 字段，保证各家兼容）
 */
export class AiOrchestrator {
  private controllers = new Map<string, AbortController>()
  private cancelled = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly db: Database,
    private readonly settingService: SettingService,
    /** 向渲染层广播事件（全局通道，渲染层按 requestId 过滤） */
    private readonly emit: (event: AiEvent) => void
  ) {}

  /** 入队并立即返回；结果经 emit 推送 */
  enqueue(job: GenerateJob): void {
    this.queue = this.queue
      .then(() => this.run(job))
      .catch((err) => console.error('[ai] queue error:', err))
  }

  cancel(requestId: string): void {
    this.cancelled.add(requestId)
    this.controllers.get(requestId)?.abort()
  }

  /** 等待队列排空（冒烟/测试用） */
  async drain(): Promise<void> {
    await this.queue
  }

  private resolveModel(scene: ModelScene): ModelContext {
    const settings = this.settingService.getSettings()
    const cfg = settings.modelConfig[scene]
    if (!cfg) {
      throw new Error(`「${scene}」场景未配置模型，请到 设置 → 模型分工 中配置`)
    }
    const provider = settings.providers.find((p) => p.id === cfg.providerId)
    if (!provider) throw new Error('所选 Provider 已被删除，请到 设置 → 模型分工 重新配置')
    return {
      providerId: provider.id,
      model: cfg.model,
      baseUrl: provider.baseUrl,
      apiKey: this.settingService.getApiKey(provider.id),
      protocol: provider.protocol ?? 'openai'
    }
  }

  private async run(job: GenerateJob): Promise<void> {
    const startedAt = Date.now()
    const logId = randomUUID()

    let ctx: ModelContext
    try {
      ctx = this.resolveModel(job.scene)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.writeLog(logId, job, '', '', 'failed', 0, 0, 0, message)
      this.emit({ type: 'error', requestId: job.requestId, error: message })
      return
    }

    this.writeLog(logId, job, ctx.providerId, ctx.model, 'running', 0, 0, 0, null)

    // 已推送给渲染层的累计文本（跨重试保留：预流式失败不会产生任何 chunk）
    let received = ''

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const { full, usage: realUsage } = await this.streamOnce(job, ctx, (text) => {
            received += text
            this.emit({ type: 'chunk', requestId: job.requestId, text })
          })
          const usage = realUsage
            ? {
                promptTokens: realUsage.promptTokens,
                completionTokens: realUsage.completionTokens,
                estimated: false
              }
            : {
                promptTokens: estimateTokens(job.prompt),
                completionTokens: estimateTokens(full),
                estimated: true
              }
          this.writeLog(
            logId,
            job,
            ctx.providerId,
            ctx.model,
            'succeeded',
            usage.promptTokens,
            usage.completionTokens,
            Date.now() - startedAt,
            null
          )
          this.emit({ type: 'finish', requestId: job.requestId, usage })
          return
        } catch (err) {
          if (this.cancelled.has(job.requestId)) {
            this.writeLog(logId, job, ctx.providerId, ctx.model, 'cancelled', 0, estimateTokens(received), Date.now() - startedAt, null)
            this.emit({ type: 'cancelled', requestId: job.requestId })
            return
          }
          const isLastAttempt = attempt === MAX_ATTEMPTS - 1
          if (err instanceof RetryableError && !isLastAttempt) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] ?? 3_000))
            continue
          }
          throw err
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.writeLog(logId, job, ctx.providerId, ctx.model, 'failed', 0, estimateTokens(received), Date.now() - startedAt, message)
      this.emit({ type: 'error', requestId: job.requestId, error: message })
    } finally {
      this.cancelled.delete(job.requestId)
      this.controllers.delete(job.requestId)
    }
  }

  /**
   * 单次流式请求：只有「拿到响应体之前」的失败才可重试。
   * 按协议分支构建请求与解析 SSE；Anthropic 协议可返回真实 usage。
   */
  private async streamOnce(
    job: GenerateJob,
    ctx: ModelContext,
    onChunk: (text: string) => void
  ): Promise<{ full: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const controller = new AbortController()
    this.controllers.set(job.requestId, controller)

    let firstChunkSeen = false
    const timer = setTimeout(() => {
      if (!firstChunkSeen) controller.abort()
    }, CONNECT_TIMEOUT_MS)

    const fail = (err: unknown): never => {
      const message = err instanceof Error ? err.message : String(err)
      // 流已开始：中断即最终失败，避免重试导致渲染层内容重复
      if (firstChunkSeen) throw new Error(`流中断：${message}（已生成内容已保留）`)
      throw new RetryableError(message)
    }

    // ---- 按协议构建请求 ----
    const url =
      ctx.protocol === 'anthropic'
        ? `${ctx.baseUrl}/v1/messages`
        : `${ctx.baseUrl}/chat/completions`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (ctx.protocol === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01'
      if (ctx.apiKey) headers['x-api-key'] = ctx.apiKey
    } else if (ctx.apiKey) {
      headers.Authorization = `Bearer ${ctx.apiKey}`
    }
    const body = JSON.stringify(
      ctx.protocol === 'anthropic'
        ? {
            model: ctx.model,
            max_tokens: job.maxTokens,
            stream: true,
            temperature: job.temperature,
            messages: [{ role: 'user', content: job.prompt }]
          }
        : {
            model: ctx.model,
            messages: [{ role: 'user', content: job.prompt }],
            stream: true,
            temperature: job.temperature,
            max_tokens: job.maxTokens
          }
    )

    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal }).catch(
        (err) => fail(err)
      )

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const msg = `HTTP ${res.status} ${body.slice(0, 300)}`.trim()
        if (res.status === 429 || res.status >= 500) throw new RetryableError(msg)
        throw new Error(msg)
      }
      if (!res.body) throw new RetryableError('响应无内容')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let full = ''
      let usage: { promptTokens: number; completionTokens: number } | undefined

      for (;;) {
        const { done, value } = await reader.read().catch((err) => fail(err))
        if (done) break
        if (!firstChunkSeen) {
          firstChunkSeen = true
          clearTimeout(timer)
        }
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const json = JSON.parse(data) as Record<string, unknown>

            if (ctx.protocol === 'anthropic') {
              // Anthropic 事件流：content_block_delta 携带正文增量
              if (json.type === 'content_block_delta') {
                const delta = json.delta as { type?: string; text?: string } | undefined
                if (delta?.type === 'text_delta' && delta.text) {
                  full += delta.text
                  onChunk(delta.text)
                }
              } else if (json.type === 'message_start') {
                const msg = json.message as { usage?: { input_tokens?: number } } | undefined
                const inputTokens = msg?.usage?.input_tokens
                if (typeof inputTokens === 'number') {
                  usage = { promptTokens: inputTokens, completionTokens: 0 }
                }
              } else if (json.type === 'message_delta') {
                const u = json.usage as { output_tokens?: number } | undefined
                if (typeof u?.output_tokens === 'number') {
                  usage = { promptTokens: usage?.promptTokens ?? 0, completionTokens: u.output_tokens }
                }
              } else if (json.type === 'message_stop') {
                return { full, usage }
              }
            } else {
              // OpenAI 兼容：choices[0].delta.content
              const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined
              const text = choices?.[0]?.delta?.content
              if (text) {
                full += text
                onChunk(text)
              }
            }
          } catch {
            // 忽略无法解析的心跳/注释行
          }
        }
      }

      if (!full && !this.cancelled.has(job.requestId)) {
        throw new RetryableError('模型未返回任何内容')
      }
      return { full, usage }
    } finally {
      clearTimeout(timer)
      this.controllers.delete(job.requestId)
    }
  }

  private writeLog(
    id: string,
    job: GenerateJob,
    providerId: string,
    model: string,
    status: string,
    promptTokens: number,
    completionTokens: number,
    latencyMs: number,
    error: string | null
  ): void {
    this.db
      .prepare(
        `INSERT INTO ai_logs (id, request_id, scene, template_code, provider_id, model,
            prompt_tokens, completion_tokens, latency_ms, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            prompt_tokens = excluded.prompt_tokens,
            completion_tokens = excluded.completion_tokens,
            latency_ms = excluded.latency_ms,
            status = excluded.status,
            error = excluded.error`
      )
      .run(
        id,
        job.requestId,
        job.scene,
        job.templateCode ?? null,
        providerId,
        model,
        promptTokens,
        completionTokens,
        latencyMs,
        status,
        error,
        Date.now()
      )
  }
}
