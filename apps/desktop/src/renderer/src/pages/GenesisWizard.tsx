import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettingsDTO, ProjectDTO } from '@inkcraft/shared'
import { parseCharacterCards } from '@inkcraft/core'

interface Props {
  project: ProjectDTO
  onFinish: () => void
  onSkip: () => void
}

type StepGen = { phase: 'idle' } | { phase: 'generating'; requestId: string } | { phase: 'error'; message: string }

const STEPS = ['创意', '世界观', '角色', '总纲'] as const

export function GenesisWizard({ project, onFinish, onSkip }: Props) {
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<AppSettingsDTO | null>(null)

  const [idea, setIdea] = useState('')
  const [styleKeywords, setStyleKeywords] = useState('')
  const [hasGoldenFinger, setHasGoldenFinger] = useState(true)
  const [characterCount, setCharacterCount] = useState(4)
  const [theme, setTheme] = useState('')

  const [worldText, setWorldText] = useState('')
  const [charactersText, setCharactersText] = useState('')
  const [outlineText, setOutlineText] = useState('')

  const [gen, setGen] = useState<StepGen>({ phase: 'idle' })
  const [saving, setSaving] = useState(false)
  const reqRef = useRef<string | null>(null)

  useEffect(() => {
    void window.inkcraft.getSettings().then(setSettings)
  }, [])

  const handleEvent = useCallback(
    (event: import('@inkcraft/shared').AiEvent): void => {
      if (event.requestId !== reqRef.current) return
      if (event.type === 'chunk') {
        if (step === 1) setWorldText((t) => t + event.text)
        else if (step === 2) setCharactersText((t) => t + event.text)
        else if (step === 3) setOutlineText((t) => t + event.text)
        return
      }
      if (event.type === 'finish') {
        setGen({ phase: 'idle' })
        return
      }
      if (event.type === 'cancelled') {
        setGen({ phase: 'idle' })
        return
      }
      setGen({ phase: 'error', message: event.error })
    },
    [step]
  )

  useEffect(() => window.inkcraft.onAiEvent(handleEvent), [handleEvent])

  const genesisModel = settings?.modelConfig.genesis
  const genesisProvider = settings?.providers.find((p) => p.id === genesisModel?.providerId)

  const generate = async (): Promise<void> => {
    if (gen.phase === 'generating') return
    if (!genesisModel) {
      window.alert('尚未配置「创世」场景模型：请回到书架，点右上角 设置 → 模型分工')
      return
    }
    const base = { idea, styleKeywords, hasGoldenFinger }
    const stepKey = step === 1 ? 'world' : step === 2 ? 'characters' : 'outline'
    const input =
      step === 2
        ? { ...base, characterCount, worldContent: worldText }
        : step === 3
          ? { ...base, theme, worldContent: worldText, charactersContent: charactersText }
          : base

    // 已有内容时确认覆盖
    const current = step === 1 ? worldText : step === 2 ? charactersText : outlineText
    if (current.trim() && !window.confirm('重新生成将覆盖当前内容（可先手动复制备份），继续？')) return

    try {
      if (step === 1) setWorldText('')
      else if (step === 2) setCharactersText('')
      else setOutlineText('')
      const res = await window.inkcraft.aiGenesis({ projectId: project.id, step: stepKey, input })
      reqRef.current = res.requestId
      setGen({ phase: 'generating', requestId: res.requestId })
    } catch (e) {
      setGen({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const finish = async (): Promise<void> => {
    setSaving(true)
    try {
      // 世界观 -> 常驻设定
      if (worldText.trim()) {
        await window.inkcraft.codexCreate({
          projectId: project.id,
          type: 'world',
          name: '世界观',
          importance: 'pinned',
          content: worldText.trim()
        })
      }
      // 角色档案 -> 按标题切分为独立角色卡
      if (charactersText.trim()) {
        const cards = parseCharacterCards(charactersText)
        if (cards.length > 0) {
          for (const c of cards) {
            await window.inkcraft.codexCreate({
              projectId: project.id,
              type: 'character',
              name: c.name,
              content: c.content
            })
          }
        } else {
          await window.inkcraft.codexCreate({
            projectId: project.id,
            type: 'character',
            name: '主要角色',
            content: charactersText.trim()
          })
        }
      }
      // 总纲
      if (outlineText.trim()) {
        await window.inkcraft.outlineSaveBook({ projectId: project.id, content: outlineText.trim() })
      }
      onFinish()
    } catch (e) {
      window.alert(`保存失败：${e instanceof Error ? e.message : String(e)}\n（可跳过向导，稍后在设定/大纲页手动补录）`)
    } finally {
      setSaving(false)
    }
  }

  const canNext = step === 0 ? idea.trim().length > 0 : true

  return (
    <div className="wizard">
      <header className="wizard-header">
        <h1>创世向导 ·《{project.title}》</h1>
        <button className="ghost" onClick={onSkip}>
          跳过，直接进工作台
        </button>
      </header>

      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 0 && (
          <div className="wizard-form">
            <label>
              核心创意（一句话到一段话，说清「主角是谁 + 什么设定 + 想看什么爽点」）
              <textarea
                rows={5}
                maxLength={3000}
                placeholder="例：修仙世界里的时间循环者，每次死亡回到七天前，用无数次轮回磨死天道宠儿"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
              />
            </label>
            <label>
              风格关键词（可选）
              <input
                placeholder="热血、冷静、慢热、爽文"
                value={styleKeywords}
                onChange={(e) => setStyleKeywords(e.target.value)}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={hasGoldenFinger}
                onChange={(e) => setHasGoldenFinger(e.target.checked)}
              />
              主角有金手指（向导会生成金手指定义与限制）
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-gen">
            <div className="wizard-gen-head">
              <span>世界观设定（可编辑，保存后作为常驻设定注入每次续写）</span>
              <div className="wizard-gen-actions">
                {gen.phase === 'generating' ? (
                  <button
                    className="stop-btn"
                    onClick={() => void window.inkcraft.aiCancel(gen.phase === 'generating' ? gen.requestId : '')}
                  >
                    ■ 停止
                  </button>
                ) : (
                  <button disabled={!idea.trim() || !genesisModel} onClick={() => void generate()}>
                    AI 生成
                  </button>
                )}
              </div>
            </div>
            <textarea
              className="wizard-textarea"
              rows={16}
              value={worldText}
              onChange={(e) => setWorldText(e.target.value)}
              placeholder="点击「AI 生成」产出世界观，或直接在此手写。小节建议：世界背景 / 力量体系 / 社会结构 / 地理 / 核心禁忌 / 金手指"
            />
          </div>
        )}

        {step === 2 && (
          <div className="wizard-gen">
            <div className="wizard-gen-head">
              <span>
                主要角色（以「### 角色名」分节，保存时自动切分为角色卡；角色名将被章纲引用）
              </span>
              <div className="wizard-gen-actions">
                <select value={characterCount} onChange={(e) => setCharacterCount(Number(e.target.value))}>
                  {[3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} 个角色
                    </option>
                  ))}
                </select>
                {gen.phase === 'generating' ? (
                  <button
                    className="stop-btn"
                    onClick={() => void window.inkcraft.aiCancel(gen.phase === 'generating' ? gen.requestId : '')}
                  >
                    ■ 停止
                  </button>
                ) : (
                  <button disabled={!genesisModel} onClick={() => void generate()}>
                    AI 生成
                  </button>
                )}
              </div>
            </div>
            <textarea
              className="wizard-textarea"
              rows={16}
              value={charactersText}
              onChange={(e) => setCharactersText(e.target.value)}
              placeholder="点击「AI 生成」产出角色档案，或直接手写（每个角色以 ### 角色名 开头）"
            />
          </div>
        )}

        {step === 3 && (
          <div className="wizard-gen">
            <div className="wizard-gen-head">
              <span>总纲（分卷走向 / 关键转折 / 伏笔清单，保存后可在工作台「大纲」页继续编辑）</span>
              <div className="wizard-gen-actions">
                <input
                  className="theme-input"
                  placeholder="主题（可选），如：小人物对抗命运"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                />
                {gen.phase === 'generating' ? (
                  <button
                    className="stop-btn"
                    onClick={() => void window.inkcraft.aiCancel(gen.phase === 'generating' ? gen.requestId : '')}
                  >
                    ■ 停止
                  </button>
                ) : (
                  <button disabled={!genesisModel} onClick={() => void generate()}>
                    AI 生成
                  </button>
                )}
              </div>
            </div>
            <textarea
              className="wizard-textarea"
              rows={16}
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              placeholder="点击「AI 生成」产出总纲，或直接手写"
            />
          </div>
        )}

        {gen.phase === 'generating' && <p className="streaming">正在流式生成…（内容实时填入上方编辑区）</p>}
        {gen.phase === 'error' && <p className="error">{gen.message}</p>}
        {!genesisModel && <p className="error">提示：「创世」场景未配置模型，AI 生成不可用（可手写）</p>}
        {genesisModel && genesisProvider && (
          <p className="model-line">
            创世模型：{genesisProvider.name} · {genesisModel.model}
          </p>
        )}
      </div>

      <footer className="wizard-footer">
        <button className="ghost" disabled={step === 0 || gen.phase === 'generating'} onClick={() => setStep((s) => s - 1)}>
          上一步
        </button>
        {step < 3 ? (
          <button disabled={!canNext || gen.phase === 'generating'} onClick={() => setStep((s) => s + 1)}>
            下一步
          </button>
        ) : (
          <button disabled={saving} onClick={() => void finish()}>
            {saving ? '保存中…' : '完成创世，进入工作台'}
          </button>
        )}
      </footer>
    </div>
  )
}
