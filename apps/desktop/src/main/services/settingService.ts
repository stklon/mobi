import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type { Database } from 'better-sqlite3'
import type {
  AppSettingsDTO,
  CreateProviderPayload,
  ModelConfigDTO,
  ModelScene,
  ProviderDTO,
  ProviderTestPayload,
  ProviderTestResult,
  SceneModelConfig,
  UpdateProviderPayload
} from '@inkcraft/shared'
import { createProviderSchema, modelConfigSchema, updateProviderSchema } from '@inkcraft/core'

/** 内部存储结构（apiKeyEnc 仅存在于主进程，永不出境） */
interface StoredProvider {
  id: string
  name: string
  baseUrl: string
  /** safeStorage(DPAPI) 加密后的 base64；空串 = 未配置 Key */
  apiKeyEnc: string
  models: string[]
}

/** safeStorage 不可用时的明文降级标记（仅极端环境） */
const PLAIN_PREFIX = 'plain:'

const SCENES: ModelScene[] = ['genesis', 'outline', 'continue', 'polish', 'extract', 'embedding']

/**
 * 设置与模型 Provider 服务。
 * - API Key 经 Windows 凭据保护（DPAPI）加密后落库，渲染层永远拿不到明文
 * - 连通性测试走 OpenAI 兼容协议 GET {baseUrl}/models
 */
export class SettingService {
  constructor(private readonly db: Database) {}

  // ---------- 读写工具 ----------

  private readJson<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  private writeJson(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), Date.now())
  }

  private getStoredProviders(): StoredProvider[] {
    return this.readJson<StoredProvider[]>('providers', [])
  }

  private toDTO(p: StoredProvider): ProviderDTO {
    return {
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      hasKey: Boolean(p.apiKeyEnc),
      models: p.models
    }
  }

  // ---------- 设置读取 ----------

  getSettings(): AppSettingsDTO {
    const providers = this.getStoredProviders().map((p) => this.toDTO(p))
    const modelConfig = this.readJson<ModelConfigDTO>('modelConfig', {})
    return { providers, modelConfig: this.pruneModelConfig(modelConfig, providers) }
  }

  // ---------- Provider CRUD ----------

  createProvider(payload: CreateProviderPayload): ProviderDTO {
    const input = createProviderSchema.parse(payload)
    const providers = this.getStoredProviders()
    if (providers.some((p) => p.name === input.name)) throw new Error('已存在同名 Provider')

    const stored: StoredProvider = {
      id: randomUUID(),
      name: input.name,
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      apiKeyEnc: this.encryptKey(input.apiKey ?? ''),
      models: input.models ?? []
    }
    this.writeJson('providers', [...providers, stored])
    return this.toDTO(stored)
  }

  updateProvider(payload: UpdateProviderPayload): ProviderDTO {
    const input = updateProviderSchema.parse(payload)
    const providers = this.getStoredProviders()
    const idx = providers.findIndex((p) => p.id === input.id)
    if (idx === -1) throw new Error('Provider 不存在')

    const prev = providers[idx]
    providers[idx] = {
      ...prev,
      name: input.name?.trim() ?? prev.name,
      baseUrl: input.baseUrl ? input.baseUrl.replace(/\/+$/, '') : prev.baseUrl,
      apiKeyEnc: input.apiKey !== undefined ? this.encryptKey(input.apiKey) : prev.apiKeyEnc,
      models: input.models ?? prev.models
    }
    this.writeJson('providers', providers)
    return this.toDTO(providers[idx])
  }

  deleteProvider(providerId: string): void {
    const providers = this.getStoredProviders().filter((p) => p.id !== providerId)
    this.writeJson('providers', providers)
    // 同步清理引用该 Provider 的场景配置
    const config = this.readJson<ModelConfigDTO>('modelConfig', {})
    this.writeJson('modelConfig', this.pruneModelConfig(config, providers.map((p) => this.toDTO(p))))
  }

  // ---------- 模型分工 ----------

  saveModelConfig(config: ModelConfigDTO): ModelConfigDTO {
    for (const scene of SCENES) {
      const cfg = config[scene]
      if (cfg) modelConfigSchema.parse(cfg)
    }
    const providers = this.getStoredProviders().map((p) => this.toDTO(p))
    const pruned = this.pruneModelConfig(config, providers)
    this.writeJson('modelConfig', pruned)
    return pruned
  }

  /** 丢弃引用了不存在 Provider / 未收录模型的场景配置（数据卫生） */
  private pruneModelConfig(config: ModelConfigDTO, providers: ProviderDTO[]): ModelConfigDTO {
    const out: ModelConfigDTO = {}
    for (const scene of SCENES) {
      const cfg = config[scene]
      if (!cfg) continue
      const provider = providers.find((p) => p.id === cfg.providerId)
      if (provider && provider.models.includes(cfg.model)) {
        out[scene] = cfg as SceneModelConfig
      }
    }
    return out
  }

  // ---------- API Key（仅主进程内部使用） ----------

  /** 供 M2 的 AI 编排器取用明文 Key */
  getApiKey(providerId: string): string {
    const p = this.getStoredProviders().find((x) => x.id === providerId)
    if (!p || !p.apiKeyEnc) return ''
    if (p.apiKeyEnc.startsWith(PLAIN_PREFIX)) return p.apiKeyEnc.slice(PLAIN_PREFIX.length)
    if (!safeStorage.isEncryptionAvailable()) return ''
    try {
      return safeStorage.decryptString(Buffer.from(p.apiKeyEnc, 'base64'))
    } catch {
      return ''
    }
  }

  private encryptKey(key: string): string {
    if (!key) return ''
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(key).toString('base64')
    }
    return PLAIN_PREFIX + key
  }

  // ---------- 连通性测试 ----------

  /**
   * 测试 Provider：传 id 用已存储配置（成功后自动回写模型列表），
   * 传 baseUrl/apiKey 测试未保存的表单。
   */
  async testProvider(payload: ProviderTestPayload): Promise<ProviderTestResult> {
    let baseUrl = payload.baseUrl?.trim()
    let apiKey = payload.apiKey ?? ''

    if (payload.id) {
      const p = this.getStoredProviders().find((x) => x.id === payload.id)
      if (!p) return { ok: false, models: [], error: 'Provider 不存在' }
      baseUrl = p.baseUrl
      if (!apiKey) apiKey = this.getApiKey(payload.id)
    }

    if (!baseUrl) return { ok: false, models: [], error: '缺少 Base URL' }

    try {
      const url = baseUrl.replace(/\/+$/, '') + '/models'
      const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, models: [], error: `HTTP ${res.status} ${body.slice(0, 200)}`.trim() }
      }
      const json = (await res.json()) as { data?: Array<{ id?: string }> }
      const models = (json.data ?? [])
        .map((m) => m.id)
        .filter((x): x is string => Boolean(x))
        .sort()

      if (payload.id) this.updateProvider({ id: payload.id, models })
      return { ok: true, models }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, models: [], error: msg }
    }
  }
}
