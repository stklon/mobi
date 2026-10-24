import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AiEvent,
  AppSettingsDTO,
  OutlineNodeDTO,
  ParsedChapterOutlineDTO,
  VolumeDTO
} from '@inkcraft/shared'
import { parseOutlineBatch } from '@inkcraft/core'

interface Props {
  projectId: string
}

interface ChapterOutlineForm {
  outlineId?: string
  chapterNo: string
  goal: string
  plotPoints: string
  characters: string
  endingHook: string
}

/** 工作台右栏「大纲」标签页：总纲/卷纲编辑 + 章纲管理 + AI 批量生成 */
export function OutlineTab({ projectId }: Props) {
  const [volumes, setVolumes] = useState<VolumeDTO[]>([])
  const [volumeId, setVolumeId] = useState('')
  const [bookContent, setBookContent] = useState('')
  const [volumeContent, setVolumeContent] = useState('')
  const [outlines, setOutlines] = useState<OutlineNodeDTO[]>([])
  const [form, setForm] = useState<ChapterOutlineForm | null>(null)
  const [savedHint, setSavedHint] = useState('')

  const [settings, setSettings] = useState<AppSettingsDTO | null>(null)
  const [batch, setBatch] = useState<{ phase: 'idle' | 'generating' | 'confirm'; raw: string; parsed: ParsedChapterOutlineDTO[] }>({ phase: 'idle', raw: '', parsed: [] })
  const [count, setCount] = useState(10)
  const batchReqRef = useRef<string | null>(null)

  const reload = useCallback(async () => {
    const [vols, book] = await Promise.all([
      window.inkcraft.volumeList(projectId),
      window.inkcraft.outlineGetBook(projectId)
    ])
    setVolumes(vols)
    setBookContent(book?.content ?? '')
    setVolumeId((prev) => (prev && vols.some((v) => v.id === prev) ? prev : vols[0]?.id ?? ''))
    const nodes = await window.inkcraft.outlineListChapters(projectId)
    setOutlines(nodes)
  }, [projectId])

  useEffect(() => {
    void reload()
    void window.inkcraft.getSettings().then(setSettings)
  }, [reload])

  useEffect(() => {
    if (!volumeId) return
    void window.inkcraft.outlineGetVolume(volumeId).then((n) => setVolumeContent(n?.content ?? ''))
  }, [volumeId])

  const handleEvent = useCallback((event: AiEvent): void => {
    if (event.requestId !== batchReqRef.current) return
    if (event.type === 'chunk') {
      setBatch((b) => ({ ...b, raw: b.raw + event.text }))
      return
    }
    if (event.type === 'finish') {
      setBatch((b) => {
        const parsedNow = parseOutlineBatch(b.raw)
        return parsedNow.length > 0
          ? { phase: 'confirm', raw: b.raw, parsed: parsedNow }
          : { phase: 'idle', raw: '', parsed: [] }
      })
      return
    }
    if (event.type === 'cancelled') {
      setBatch({ phase: 'idle', raw: '', parsed: [] })
      return
    }
    window.alert(`批量生成失败：${event.error}`)
    setBatch({ phase: 'idle', raw: '', parsed: [] })
  }, [])

  useEffect(() => window.inkcraft.onAiEvent(handleEvent), [handleEvent])

  const outlineModel = settings?.modelConfig.outline
  const volumeOutlines = outlines.filter((n) => n.volumeId === volumeId)

  const flash = (msg: string): void => {
    setSavedHint(msg)
    setTimeout(() => setSavedHint(''), 2000)
  }

  const saveBook = async (): Promise<void> => {
    await window.inkcraft.outlineSaveBook({ projectId, content: bookContent })
    flash('总纲已保存')
  }

  const saveVolumeOutline = async (): Promise<void> => {
    if (!volumeId) return
    await window.inkcraft.outlineSaveVolume({ volumeId, content: volumeContent })
    flash('卷纲已保存')
  }

  const openChapterForm = (node?: OutlineNodeDTO): void => {
    if (node) {
      setForm({
        outlineId: node.id,
        chapterNo: String(node.chapterNo ?? ''),
        goal: node.goal,
        plotPoints: node.plotPoints.join('\n'),
        characters: node.characters.join('、'),
        endingHook: node.endingHook
      })
    } else {
      const nextNo = outlines.length > 0 ? Math.max(...outlines.map((n) => n.chapterNo ?? 0)) + 1 : 1
      setForm({ chapterNo: String(nextNo), goal: '', plotPoints: '', characters: '', endingHook: '' })
    }
  }

  const saveChapterOutline = async (): Promise<void> => {
    if (!form || !volumeId) return
    const no = Number(form.chapterNo)
    if (!Number.isInteger(no) || no < 1) {
      window.alert('章号需为正整数')
      return
    }
    await window.inkcraft.outlineSaveChapter({
      projectId,
      volumeId,
      chapterNo: no,
      goal: form.goal.trim(),
      plotPoints: form.plotPoints.split('\n').map((s) => s.trim()).filter(Boolean),
      characters: form.characters.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
      endingHook: form.endingHook.trim()
    })
    setForm(null)
    await reload()
    flash(`第${no}章纲已保存`)
  }

  const startBatch = async (): Promise<void> => {
    if (!volumeId) return
    if (!outlineModel) {
      window.alert('尚未配置「大纲」场景模型：请到 设置 → 模型分工')
      return
    }
    const nextNo = outlines.length > 0 ? Math.max(...outlines.map((n) => n.chapterNo ?? 0)) + 1 : 1
    try {
      const res = await window.inkcraft.aiOutlineBatch({ projectId, volumeId, startNo: nextNo, count })
      batchReqRef.current = res.requestId
      setBatch({ phase: 'generating', raw: '', parsed: [] })
    } catch (e) {
      window.alert(`发起失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const confirmBatch = async (): Promise<void> => {
    if (!volumeId) return
    for (const p of batch.parsed) {
      await window.inkcraft.outlineSaveChapter({
        projectId,
        volumeId,
        chapterNo: p.no,
        title: p.title,
        goal: p.goal,
        plotPoints: p.plotPoints,
        characters: p.characters,
        endingHook: p.endingHook,
        status: 'confirmed'
      })
    }
    setBatch({ phase: 'idle', raw: '', parsed: [] })
    await reload()
    flash(`已入库 ${batch.parsed.length} 条章纲`)
  }

  return (
    <div className="outline-tab">
      <section className="outline-section">
        <h4>总纲</h4>
        <textarea
          rows={5}
          value={bookContent}
          placeholder="全书总纲（创世向导生成或手写）：梗概 / 分卷走向 / 关键转折 / 伏笔清单"
          onChange={(e) => setBookContent(e.target.value)}
        />
        <button onClick={() => void saveBook()}>保存总纲</button>
      </section>

      <section className="outline-section">
        <h4>卷纲</h4>
        <select value={volumeId} onChange={(e) => setVolumeId(e.target.value)}>
          {volumes.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>
        <textarea
          rows={4}
          value={volumeContent}
          placeholder="本卷走向：阶段划分 / 新登场要素 / 卷末高潮"
          onChange={(e) => setVolumeContent(e.target.value)}
        />
        <button onClick={() => void saveVolumeOutline()}>保存卷纲</button>
      </section>

      <section className="outline-section">
        <h4>章纲（{volumeOutlines.length} 条）</h4>
        <div className="batch-row">
          <button disabled={!outlineModel || batch.phase !== 'idle'} onClick={() => void startBatch()}>
            AI 批量生成 {count} 章纲
          </button>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={batch.phase !== 'idle'}>
            {[5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n} 章
              </option>
            ))}
          </select>
        </div>
        {batch.phase === 'generating' && (
          <p className="streaming">生成中…（已收 {batch.raw.length} 字，完成后解析为章纲卡片）</p>
        )}
        {batch.phase === 'confirm' && (
          <div className="batch-confirm">
            <p>解析出 {batch.parsed.length} 条章纲（将覆盖同章号已有章纲）：</p>
            <div className="batch-list">
              {batch.parsed.map((p) => (
                <div key={p.no} className="batch-item">
                  第{p.no}章 {p.title}：{p.goal.slice(0, 40)}
                </div>
              ))}
            </div>
            <div className="codex-form-actions">
              <button onClick={() => void confirmBatch()}>全部入库</button>
              <button className="ghost" onClick={() => setBatch({ phase: 'idle', raw: '', parsed: [] })}>
                丢弃
              </button>
            </div>
          </div>
        )}

        <button className="ghost add-outline-btn" onClick={() => openChapterForm()}>
          + 手动新增章纲
        </button>

        {form && (
          <div className="codex-form">
            <div className="codex-form-row">
              <input
                className="chapter-no-input"
                placeholder="章号"
                value={form.chapterNo}
                onChange={(e) => setForm({ ...form, chapterNo: e.target.value })}
              />
              <span className="scene-hint">第 {form.chapterNo || '?'} 章写作计划</span>
            </div>
            <input
              placeholder="本章目标（一句话，本章必须完成的事）"
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
            />
            <textarea
              placeholder="情节要点（每行一条）"
              rows={4}
              value={form.plotPoints}
              onChange={(e) => setForm({ ...form, plotPoints: e.target.value })}
            />
            <input
              placeholder="出场角色（用、分隔，需与设定集角色名/别名一致）"
              value={form.characters}
              onChange={(e) => setForm({ ...form, characters: e.target.value })}
            />
            <input
              placeholder="章末钩子"
              value={form.endingHook}
              onChange={(e) => setForm({ ...form, endingHook: e.target.value })}
            />
            <div className="codex-form-actions">
              <button onClick={() => void saveChapterOutline()}>保存章纲</button>
              <button className="ghost" onClick={() => setForm(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        <ul className="outline-list">
          {volumeOutlines.map((n) => (
            <li key={n.id} className="outline-item" onClick={() => openChapterForm(n)}>
              <div className="outline-item-head">
                <span className="chapter-no">第{n.chapterNo}章</span>
                <span className="chapter-title">{n.title}</span>
              </div>
              <div className="outline-item-goal">{n.goal || '（无目标）'}</div>
              {n.characters.length > 0 && (
                <div className="outline-item-chars">出场：{n.characters.join('、')}</div>
              )}
            </li>
          ))}
          {volumeOutlines.length === 0 && (
            <li className="settings-empty">本卷暂无章纲。写好卷纲后点「AI 批量生成」，或手动新增。</li>
          )}
        </ul>
      </section>

      {savedHint && <p className="ok">{savedHint}</p>}
    </div>
  )
}
