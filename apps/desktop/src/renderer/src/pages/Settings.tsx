import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettingsDTO,
  ModelScene,
  ProviderDTO,
  ProviderTestResult
} from '@inkcraft/shared'

interface Props {
  onBack: () => void
}

interface ProviderForm {
  /** 有 id = 编辑已存在的 Provider */
  id?: string
  name: string
  baseUrl: string
  protocol: 'openai' | 'anthropic'
  apiKey: string
  models: string[]
  /** 进入编辑时的原始值，用于判断「测试」走已存配置还是表单值 */
  origBaseUrl: string
}

const SCENE_ROWS: { key: ModelScene; label: string; hint: string }[] = [
  { key: 'genesis', label: '创世', hint: '世界观 / 角色 / 总纲生成，质量优先' },
  { key: 'outline', label: '大纲', hint: '卷纲 / 章纲生成，结构能力优先' },
  { key: 'continue', label: '正文续写', hint: '建议长上下文高质量模型' },
  { key: 'polish', label: '润色 / 扩写', hint: '改写与扩写选区' },
  { key: 'extract', label: '摘要与提取', hint: '章后归档等后台任务，建议廉价快速模型' },
  { key: 'embedding', label: '嵌入（RAG 检索）', hint: '走 /embeddings 接口（仅 OpenAI 协议），如 bge / text-embedding 系列；不配则 RAG 降级为实体关键词检索' }
]

const PROVIDER_PRESETS: { label: string; name: string; baseUrl: string; protocol: 'openai' | 'anthropic' }[] = [
  { label: '百炼 Coding Plan', name: '百炼 Coding Plan', baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic', protocol: 'anthropic' },
  { label: '阿里百炼（按量付费）', name: '阿里百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai' },
  { label: 'DeepSeek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai' },
  { label: 'Z.ai Coding Plan', name: 'Z.ai Coding Plan', baseUrl: 'https://api.z.ai/api/anthropic', protocol: 'anthropic' },
  { label: '智谱 Coding Plan（国内）', name: '智谱 Coding Plan', baseUrl: 'https://open.bigmodel.cn/api/anthropic', protocol: 'anthropic' }
]

const EMPTY_FORM: ProviderForm = { name: '', baseUrl: '', protocol: 'openai', apiKey: '', models: [], origBaseUrl: '' }

export function Settings({ onBack }: Props) {
  const [settings, setSettings] = useState<AppSettingsDTO | null>(null)
  const [form, setForm] = useState<ProviderForm | null>(null)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setSettings(await window.inkcraft.getSettings())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // ---------- Provider 表单 ----------

  const openCreate = (): void => {
    setForm({ ...EMPTY_FORM })
    setTestResult(null)
    setError('')
  }

  const openEdit = (p: ProviderDTO): void => {
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      protocol: p.protocol,
      apiKey: '',
      models: p.models,
      origBaseUrl: p.baseUrl
    })
    setTestResult(null)
    setError('')
  }

  const test = async (): Promise<void> => {
    if (!form) return
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      // 编辑态且未改 Key、未改地址时，直接用已存储配置测试（Key 不出主进程）
      const useStored = Boolean(form.id) && !form.apiKey && form.baseUrl === form.origBaseUrl
      const result = await window.inkcraft.providerTest(
        useStored
          ? { id: form.id }
          : { baseUrl: form.baseUrl, apiKey: form.apiKey, protocol: form.protocol }
      )
      setTestResult(result)
      if (result.ok) setForm({ ...form, models: result.models.length > 0 ? result.models : form.models })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!form) return
    setSaving(true)
    setError('')
    try {
      if (form.id) {
        await window.inkcraft.providerUpdate({
          id: form.id,
          name: form.name,
          baseUrl: form.baseUrl,
          protocol: form.protocol,
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          models: form.models
        })
      } else {
        await window.inkcraft.providerCreate({
          name: form.name,
          baseUrl: form.baseUrl,
          protocol: form.protocol,
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          models: form.models
        })
      }
      setForm(null)
      setTestResult(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: ProviderDTO): Promise<void> => {
    if (!window.confirm(`确定删除 Provider「${p.name}」？相关场景分工将一并清除。`)) return
    await window.inkcraft.providerDelete(p.id)
    await reload()
  }

  const refreshModels = async (p: ProviderDTO): Promise<void> => {
    const result = await window.inkcraft.providerTest({ id: p.id })
    if (!result.ok) window.alert(`刷新失败：${result.error ?? '未知错误'}`)
    await reload()
  }

  // ---------- 模型分工 ----------

  const setScene = async (scene: ModelScene, providerId: string, model: string): Promise<void> => {
    if (!settings) return
    const next = { ...settings.modelConfig }
    if (!providerId) {
      delete next[scene]
    } else {
      next[scene] = { providerId, model }
    }
    const saved = await window.inkcraft.saveModelConfig(next)
    setSettings({ ...settings, modelConfig: saved })
  }

  const providerById = (id: string): ProviderDTO | undefined =>
    settings?.providers.find((p) => p.id === id)

  return (
    <div className="settings">
      <header className="settings-header">
        <button className="ghost" onClick={onBack}>
          ← 书架
        </button>
        <h1>设置</h1>
      </header>

      <section className="settings-section">
        <h2>模型服务</h2>
        <p className="section-hint">
          支持所有 OpenAI 兼容服务：DeepSeek、智谱 GLM、Kimi、通义、OpenAI 等；本地 Ollama 填
          <code> http://localhost:11434/v1</code>（无需 API Key）。Key 使用 Windows 凭据保护加密存储，不会离开本机。
        </p>

        <ul className="provider-list">
          {(settings?.providers ?? []).map((p) => (
            <li key={p.id} className="provider-card">
              <div className="provider-info">
                <div className="provider-name">
                  {p.name}
                  <span className="provider-key-badge">
                    {p.protocol === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 协议'}
                  </span>
                  <span className="provider-key-badge">{p.hasKey ? '已配置 Key' : '无 Key'}</span>
                </div>
                <div className="provider-url">{p.baseUrl}</div>
                <div className="provider-models">
                  {p.models.length > 0 ? `${p.models.length} 个模型` : '尚未拉取模型列表'}
                </div>
              </div>
              <div className="provider-actions">
                <button className="ghost" onClick={() => void refreshModels(p)}>
                  刷新模型
                </button>
                <button className="ghost" onClick={() => openEdit(p)}>
                  编辑
                </button>
                <button className="danger" onClick={() => void remove(p)}>
                  删除
                </button>
              </div>
            </li>
          ))}
          {(settings?.providers.length ?? 0) === 0 && (
            <li className="settings-empty">还没有配置任何模型服务，点击下方按钮添加。</li>
          )}
        </ul>

        {form ? (
          <div className="provider-form">
            <h3>{form.id ? '编辑 Provider' : '添加 Provider'}</h3>
            {!form.id && (
              <div className="preset-row">
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="ghost"
                    onClick={() => setForm({ ...form, name: p.name, baseUrl: p.baseUrl, protocol: p.protocol })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <label>
              名称
              <input
                value={form.name}
                maxLength={50}
                placeholder="如 DeepSeek / Z.ai Coding Plan"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              接口协议
              <select
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value as 'openai' | 'anthropic' })}
              >
                <option value="openai">OpenAI 兼容（/chat/completions）</option>
                <option value="anthropic">Anthropic（/v1/messages）</option>
              </select>
            </label>
            <label>
              Base URL
              <input
                value={form.baseUrl}
                placeholder={form.protocol === 'anthropic' ? 'https://api.z.ai/api/anthropic' : 'https://api.deepseek.com/v1'}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </label>
            <label>
              API Key{form.id ? '（留空表示不修改）' : ''}
              <input
                type="password"
                value={form.apiKey}
                maxLength={500}
                placeholder="sk-..."
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
            </label>
            <div className="provider-form-actions">
              <button className="ghost" disabled={testing || !form.baseUrl} onClick={() => void test()}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button
                disabled={saving || !form.name.trim() || !form.baseUrl.trim()}
                onClick={() => void save()}
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setForm(null)
                  setTestResult(null)
                }}
              >
                取消
              </button>
            </div>
            {testResult &&
              (testResult.ok ? (
                <p className="ok">连接成功，发现 {testResult.models.length} 个模型（保存时写入列表）。</p>
              ) : (
                <p className="error">连接失败：{testResult.error}</p>
              ))}
            {error && <p className="error">{error}</p>}
          </div>
        ) : (
          <button className="ghost" onClick={openCreate}>
            + 添加 Provider
          </button>
        )}
      </section>

      <section className="settings-section">
        <h2>模型分工</h2>
        <p className="section-hint">不同环节可使用不同模型：生成类场景用高质量模型，后台摘要/提取用廉价模型以控制成本。</p>
        <table className="scene-table">
          <thead>
            <tr>
              <th>场景</th>
              <th>Provider</th>
              <th>模型</th>
            </tr>
          </thead>
          <tbody>
            {SCENE_ROWS.map(({ key, label, hint }) => {
              const current = settings?.modelConfig[key]
              const provider = current ? providerById(current.providerId) : undefined
              return (
                <tr key={key}>
                  <td>
                    <div className="scene-label">{label}</div>
                    <div className="scene-hint">{hint}</div>
                  </td>
                  <td>
                    <select
                      value={current?.providerId ?? ''}
                      onChange={(e) => {
                        const pid = e.target.value
                        const p = pid ? providerById(pid) : undefined
                        const firstModel = p?.models[0] ?? ''
                        void setScene(key, pid, firstModel)
                      }}
                    >
                      <option value="">未配置</option>
                      {(settings?.providers ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="scene-model-input"
                      list={`models-${key}`}
                      value={current?.model ?? ''}
                      disabled={!provider}
                      placeholder={provider?.models[0] ?? '手输模型名'}
                      onChange={(e) => void setScene(key, current!.providerId, e.target.value.trim())}
                    />
                    <datalist id={`models-${key}`}>
                      {(provider?.models ?? []).map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    {provider && provider.models.length === 0 && (
                      <div className="scene-hint">无模型列表（Anthropic 协议常见），直接手输，如 GLM-5.3</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
