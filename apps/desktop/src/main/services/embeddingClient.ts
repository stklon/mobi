import type { SettingService } from './settingService'

const BATCH_SIZE = 32
const TIMEOUT_MS = 30_000

/**
 * 嵌入客户端：OpenAI 兼容 POST /embeddings。
 * 「embedding」场景未配置时返回 null，RAG 自动降级为纯关键词（实体）检索。
 */
export class EmbeddingClient {
  constructor(private readonly settings: SettingService) {}

  isConfigured(): boolean {
    return Boolean(this.getProvider())
  }

  /** 当前嵌入模型名（写入 chunks.embedding_model，用于换模型后识别需重建） */
  getModelName(): string | null {
    return this.getProvider()?.model ?? null
  }

  async embed(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return []
    const resolved = this.getProvider()
    if (!resolved) return null

    const out: number[][] = []
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const res = await fetch(`${resolved.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(resolved.apiKey ? { Authorization: `Bearer ${resolved.apiKey}` } : {})
        },
        body: JSON.stringify({ model: resolved.model, input: batch }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`嵌入服务 HTTP ${res.status} ${body.slice(0, 200)}`.trim())
      }
      const json = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> }
      const embeddings = (json.data ?? []).slice().sort((a, b) => a.index - b.index)
      if (embeddings.length !== batch.length) throw new Error('嵌入返回数量与输入不一致')
      for (const e of embeddings) out.push(e.embedding)
    }
    return out
  }

  private getProvider(): { baseUrl: string; apiKey: string; model: string } | null {
    const s = this.settings.getSettings()
    const cfg = s.modelConfig.embedding
    if (!cfg) return null
    const provider = s.providers.find((p) => p.id === cfg.providerId)
    if (!provider) return null
    return {
      baseUrl: provider.baseUrl,
      apiKey: this.settings.getApiKey(provider.id),
      model: cfg.model
    }
  }
}
