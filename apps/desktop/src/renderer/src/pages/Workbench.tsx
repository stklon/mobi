import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type {
  AiEvent,
  AppSettingsDTO,
  ChapterDTO,
  ChapterMetaDTO,
  PolishOperation,
  ProjectDTO,
  RagStatusDTO,
  SnapshotDTO,
  VolumeDTO
} from '@inkcraft/shared'
import { countWords } from '@inkcraft/core'
import {
  ChapterEditor,
  appendDraftText,
  clearDraftMarks,
  setEditorContent
} from '../components/ChapterEditor'
import type { SelectionInfo } from '../components/ChapterEditor'
import { CodexTab } from '../components/CodexTab'
import { OutlineTab } from '../components/OutlineTab'

interface Props {
  project: ProjectDTO
  onBack: () => void
}

type SaveState = 'saved' | 'dirty' | 'saving'

interface PendingSave {
  id: string
  title: string
  content: string
}

type ContinueGen =
  | { phase: 'idle' }
  | { phase: 'generating'; requestId: string }
  | {
      phase: 'done'
      usage: { promptTokens: number; completionTokens: number; estimated: boolean }
      snapshotId?: string
    }
  | { phase: 'error'; message: string }

interface PolishState {
  phase: 'idle' | 'generating' | 'result'
  operation: PolishOperation
  selection: string
  result: string
  requestId?: string
}

const POLISH_LABELS: Record<PolishOperation, string> = {
  polish: '润色',
  rewrite: '改写',
  expand: '扩写',
  shorten: '缩写'
}

const WORD_COUNT_OPTIONS = [500, 800, 1000, 1500, 2000]

export function Workbench({ project, onBack }: Props) {
  const [volumes, setVolumes] = useState<VolumeDTO[]>([])
  const [chapters, setChapters] = useState<ChapterMetaDTO[]>([])
  const [volumeId, setVolumeId] = useState('')
  const [chapter, setChapter] = useState<ChapterDTO | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const pendingRef = useRef<PendingSave | null>(null)

  // ---- AI 状态 ----
  const [settings, setSettings] = useState<AppSettingsDTO | null>(null)
  const [gen, setGen] = useState<ContinueGen>({ phase: 'idle' })
  const [polish, setPolish] = useState<PolishState>({
    phase: 'idle',
    operation: 'polish',
    selection: '',
    result: ''
  })
  const [directive, setDirective] = useState('')
  const [wordCount, setWordCount] = useState(1000)
  const [snapshots, setSnapshots] = useState<SnapshotDTO[]>([])
  const [selectedSnapshot, setSelectedSnapshot] = useState('')
  const [panelTab, setPanelTab] = useState<'ai' | 'codex' | 'outline'>('ai')
  const [summaryText, setSummaryText] = useState('')
  const [summaryPhase, setSummaryPhase] = useState<'idle' | 'generating' | 'dirty'>('idle')
  const [ragStat, setRagStat] = useState<RagStatusDTO | null>(null)

  const editorRef = useRef<Editor | null>(null)
  const continueReqRef = useRef<string | null>(null)
  const polishReqRef = useRef<string | null>(null)
  const summarizeReqRef = useRef<string | null>(null)
  const continueSnapRef = useRef<string | undefined>(undefined)
  const genPhaseRef = useRef<ContinueGen['phase']>('idle')
  genPhaseRef.current = gen.phase

  const busy = gen.phase === 'generating' || polish.phase === 'generating'

  const loadChapters = useCallback(async () => {
    setChapters(await window.inkcraft.chapterList(project.id))
  }, [project.id])

  const refreshSnapshots = useCallback(async () => {
    if (!chapter) return
    setSnapshots(await window.inkcraft.snapshotList(chapter.id))
  }, [chapter])

  useEffect(() => {
    void window.inkcraft.getSettings().then(setSettings)
  }, [])

  const refreshRagStatus = useCallback(async () => {
    setRagStat(await window.inkcraft.ragStatus(project.id))
  }, [project.id])

  useEffect(() => {
    void refreshRagStatus()
  }, [refreshRagStatus])

  // 章节切换时载入已有摘要
  useEffect(() => {
    if (!chapter) {
      setSummaryText('')
      setSummaryPhase('idle')
      return
    }
    void window.inkcraft.memoryGetSummary(project.id, chapter.no).then((s) => {
      setSummaryText(s?.content ?? '')
      setSummaryPhase('idle')
    })
  }, [chapter, project.id])

  useEffect(() => {
    void (async () => {
      const vols = await window.inkcraft.volumeList(project.id)
      setVolumes(vols)
      setVolumeId(vols[0]?.id ?? '')
      await loadChapters()
    })()
  }, [project.id, loadChapters])

  useEffect(() => {
    void refreshSnapshots()
  }, [refreshSnapshots])

  // ---------- 保存 ----------

  const flushSave = useCallback(async (): Promise<void> => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    setSaveState('saving')
    await window.inkcraft.chapterSave({ id: pending.id, title: pending.title, content: pending.content })
    setSaveState('saved')
    void loadChapters()
  }, [loadChapters])

  // 卸载（返回书架）前冲刷未保存内容
  useEffect(() => {
    return () => {
      const pending = pendingRef.current
      if (pending) void window.inkcraft.chapterSave({ id: pending.id, title: pending.title, content: pending.content })
    }
  }, [])

  // 防抖自动保存：编辑停顿 1 秒后落库
  useEffect(() => {
    if (!chapter) return
    pendingRef.current = { id: chapter.id, title, content }
    setSaveState('dirty')
    const timer = setTimeout(() => {
      void flushSave()
    }, 1000)
    return () => clearTimeout(timer)
  }, [title, content, chapter, flushSave])

  // ---------- 章节切换（生成期间锁定） ----------

  const openChapter = async (id: string): Promise<void> => {
    if (busy) {
      window.alert('AI 正在生成，请等待完成或先停止')
      return
    }
    await flushSave()
    const c = await window.inkcraft.chapterGet(id)
    if (c) {
      setChapter(c)
      setTitle(c.title)
      setContent(c.content)
      setSaveState('saved')
      setSelectedSnapshot('')
    }
  }

  const addChapter = async (): Promise<void> => {
    if (!volumeId) return
    if (busy) {
      window.alert('AI 正在生成，请等待完成或先停止')
      return
    }
    await flushSave()
    const c = await window.inkcraft.chapterCreate({ projectId: project.id, volumeId })
    await loadChapters()
    setChapter(c)
    setTitle(c.title)
    setContent(c.content)
    setSaveState('saved')
    setSelectedSnapshot('')
  }

  // ---------- AI 事件（挂载时订阅，按 requestId 分流） ----------

  const handleContinueEvent = useCallback((event: AiEvent): void => {
    if (event.type === 'chunk') {
      if (editorRef.current) appendDraftText(editorRef.current, event.text)
      return
    }
    if (event.type === 'finish') {
      setGen({ phase: 'done', usage: event.usage, snapshotId: continueSnapRef.current })
      return
    }
    if (event.type === 'cancelled') {
      setGen({ phase: 'idle' })
      return
    }
    setGen({ phase: 'error', message: event.error })
  }, [])

  const handlePolishEvent = useCallback((event: AiEvent): void => {
    if (event.type === 'chunk') {
      setPolish((p) => ({ ...p, result: p.result + event.text }))
      return
    }
    if (event.type === 'finish') {
      setPolish((p) => ({ ...p, phase: 'result' }))
      return
    }
    if (event.type === 'cancelled') {
      setPolish((p) => ({ ...p, phase: p.result ? 'result' : 'idle' }))
      return
    }
    setPolish((p) => ({ ...p, phase: p.result ? 'result' : 'idle' }))
    window.alert(`生成失败：${event.error}`)
  }, [])

  const handleSummarizeEvent = useCallback((event: AiEvent): void => {
    if (event.type === 'chunk') {
      setSummaryText((t) => t + event.text)
      return
    }
    if (event.type === 'finish') {
      setSummaryPhase('dirty')
      return
    }
    if (event.type === 'cancelled') {
      setSummaryPhase('dirty')
      return
    }
    window.alert(`摘要生成失败：${event.error}`)
    setSummaryPhase('dirty')
  }, [])

  useEffect(() => {
    const unsubscribe = window.inkcraft.onAiEvent((event) => {
      if (event.requestId === continueReqRef.current) handleContinueEvent(event)
      else if (event.requestId === polishReqRef.current) handlePolishEvent(event)
      else if (event.requestId === summarizeReqRef.current) handleSummarizeEvent(event)
    })
    return unsubscribe
  }, [handleContinueEvent, handlePolishEvent, handleSummarizeEvent])

  // ---------- 续写 ----------

  const startContinue = useCallback(async (): Promise<void> => {
    if (!chapter) return
    if (busy) return
    if (!settings?.modelConfig.continue) {
      window.alert('尚未配置「正文续写」模型：请回到书架，点右上角 设置 → 模型分工')
      return
    }
    await flushSave()
    try {
      const res = await window.inkcraft.aiContinue({
        chapterId: chapter.id,
        directive: directive.trim() || undefined,
        wordCount
      })
      continueReqRef.current = res.requestId
      continueSnapRef.current = res.snapshotId
      setGen({ phase: 'generating', requestId: res.requestId })
    } catch (e) {
      setGen({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [chapter, busy, settings, directive, wordCount, flushSave])

  // Ctrl+Enter 续写
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        void startContinue()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startContinue])

  const acceptDraft = (): void => {
    if (editorRef.current) clearDraftMarks(editorRef.current)
    setGen({ phase: 'idle' })
    setDirective('')
  }

  const rollbackContinue = async (): Promise<void> => {
    if (!editorRef.current) return
    const snapshotId = gen.phase === 'done' ? gen.snapshotId : continueSnapRef.current
    if (!snapshotId) return
    if (!window.confirm('回滚到本次 AI 生成前的内容？')) return
    const restored = await window.inkcraft.snapshotRestore(snapshotId)
    setEditorContent(editorRef.current, restored.content)
    setContent(restored.content)
    setGen({ phase: 'idle' })
    void refreshSnapshots()
    void loadChapters()
  }

  // ---------- 划词润色 ----------

  const startPolish = useCallback(
    async (operation: PolishOperation, info: SelectionInfo): Promise<void> => {
      if (!chapter) return
      if (busy) {
        window.alert('AI 正在生成，请等待完成或先停止')
        return
      }
      if (!settings?.modelConfig.polish) {
        window.alert('尚未配置「润色 / 扩写」模型：请回到书架，点右上角 设置 → 模型分工')
        return
      }
      await flushSave()
      try {
        const res = await window.inkcraft.aiPolish({
          chapterId: chapter.id,
          selection: info.selection,
          operation,
          contextBefore: info.contextBefore
        })
        polishReqRef.current = res.requestId
        setPolish({ phase: 'generating', operation, selection: info.selection, result: '' })
      } catch (e) {
        window.alert(`发起失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [chapter, busy, settings, flushSave]
  )

  const applyPolish = async (): Promise<void> => {
    if (!chapter || !editorRef.current || !polish.result) return
    const replaced = content.replace(polish.selection, polish.result)
    if (replaced === content) {
      window.alert('原选区内容已变化，无法自动替换。生成结果可手动复制粘贴。')
      return
    }
    await window.inkcraft.snapshotCreate(chapter.id, 'before_polish', `${POLISH_LABELS[polish.operation]}前`)
    setEditorContent(editorRef.current, replaced)
    setContent(replaced)
    setPolish({ phase: 'idle', operation: polish.operation, selection: '', result: '' })
    void refreshSnapshots()
  }

  // ---------- 快照 ----------

  const restoreSnapshot = async (): Promise<void> => {
    if (!selectedSnapshot || !editorRef.current) return
    if (!window.confirm('用所选快照覆盖当前章节内容？当前内容可先手动留快照。')) return
    if (busy) {
      window.alert('AI 正在生成，请等待完成或先停止')
      return
    }
    const restored = await window.inkcraft.snapshotRestore(selectedSnapshot)
    setEditorContent(editorRef.current, restored.content)
    setContent(restored.content)
    setTitle(restored.title)
    setGen({ phase: 'idle' })
    void loadChapters()
    void refreshSnapshots()
  }

  // ---------- 章后归档（记忆 + RAG 索引） ----------

  const startSummarize = async (): Promise<void> => {
    if (!chapter) return
    if (busy || summaryPhase === 'generating') return
    if (!settings?.modelConfig.extract) {
      window.alert('尚未配置「摘要与提取」场景模型：请到 书架 → 设置 → 模型分工')
      return
    }
    await flushSave()
    try {
      const res = await window.inkcraft.aiSummarize({ chapterId: chapter.id })
      summarizeReqRef.current = res.requestId
      setSummaryText('')
      setSummaryPhase('generating')
    } catch (e) {
      window.alert(`发起失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const saveSummary = async (): Promise<void> => {
    if (!chapter || !summaryText.trim()) return
    try {
      await window.inkcraft.memorySaveSummary({
        projectId: project.id,
        chapterNo: chapter.no,
        content: summaryText.trim()
      })
      setSummaryPhase('idle')
      await refreshRagStatus()
    } catch (e) {
      window.alert(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const rebuildRag = async (): Promise<void> => {
    if (
      !window.confirm(
        '重建全书 RAG 索引？将重新切片并嵌入所有已写章节与设定（配置了嵌入服务时会产生少量调用）。'
      )
    ) {
      return
    }
    try {
      await window.inkcraft.ragRebuild(project.id)
      await refreshRagStatus()
    } catch (e) {
      window.alert(`重建失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ---------- 渲染 ----------

  const visibleChapters = chapters.filter((c) => c.volumeId === volumeId)
  const currentWordCount = countWords(content)
  const continueModel = settings?.modelConfig.continue
  const continueProvider = settings?.providers.find((p) => p.id === continueModel?.providerId)
  const polishModel = settings?.modelConfig.polish
  const polishProvider = settings?.providers.find((p) => p.id === polishModel?.providerId)

  return (
    <div className="workbench">
      <header className="workbench-header">
        <button
          className="ghost"
          onClick={() => {
            if (busy) {
              window.alert('AI 正在生成，请等待完成或先停止')
              return
            }
            void flushSave().then(onBack)
          }}
        >
          ← 书架
        </button>
        <div className="workbench-title">
          《{project.title}》
          <span className="tag">{project.genre}</span>
        </div>
      </header>

      <div className="workbench-body">
        <aside className="sidebar">
          <div className="sidebar-head">
            <select value={volumeId} onChange={(e) => setVolumeId(e.target.value)}>
              {volumes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
            <button onClick={() => void addChapter()} disabled={!volumeId || busy}>
              + 新章
            </button>
          </div>
          <ul className="chapter-list">
            {visibleChapters.map((c) => (
              <li
                key={c.id}
                className={chapter?.id === c.id ? 'active' : ''}
                onClick={() => void openChapter(c.id)}
              >
                <span className="chapter-no">第{c.no}章</span>
                <span className="chapter-title">{c.title}</span>
                <span className="chapter-words">{c.wordCount}字</span>
              </li>
            ))}
            {visibleChapters.length === 0 && (
              <li className="chapter-empty">暂无章节，点击「+ 新章」开始创作</li>
            )}
          </ul>
        </aside>

        <main className="editor">
          {chapter ? (
            <>
              <div className="editor-head">
                <input
                  className="chapter-title-input"
                  value={title}
                  maxLength={100}
                  placeholder="章节标题"
                  onChange={(e) => setTitle(e.target.value)}
                />
                <span className={`save-state ${saveState}`}>
                  {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '未保存'}
                </span>
                <span className="word-count">{currentWordCount} 字</span>
              </div>
              <div className="editor-scroll">
                <ChapterEditor
                  chapterId={chapter.id}
                  content={content}
                  onContentChange={setContent}
                  editorRef={editorRef}
                  onPolishRequest={(op, info) => void startPolish(op, info)}
                />
              </div>
            </>
          ) : (
            <div className="editor-placeholder">
              <p>选择左侧章节，或新建一章开始创作。</p>
            </div>
          )}
        </main>

        <aside className="ai-panel">
          <div className="panel-tabs">
            <button className={panelTab === 'ai' ? 'active' : ''} onClick={() => setPanelTab('ai')}>
              AI
            </button>
            <button
              className={panelTab === 'codex' ? 'active' : ''}
              onClick={() => setPanelTab('codex')}
            >
              设定
            </button>
            <button
              className={panelTab === 'outline' ? 'active' : ''}
              onClick={() => setPanelTab('outline')}
            >
              大纲
            </button>
          </div>

          {panelTab === 'codex' && <CodexTab projectId={project.id} />}
          {panelTab === 'outline' && <OutlineTab projectId={project.id} />}

          {panelTab === 'ai' && (
            <>
              <h3>AI 续写</h3>
          {continueModel && continueProvider ? (
            <p className="model-line">
              {continueProvider.name} · {continueModel.model}
            </p>
          ) : (
            <p className="error">未配置模型：书架 → 设置 → 模型分工（正文续写）</p>
          )}
          <div className="ai-controls">
            <select value={wordCount} onChange={(e) => setWordCount(Number(e.target.value))}>
              {WORD_COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 字
                </option>
              ))}
            </select>
            <input
              placeholder="本次指令（可选）"
              value={directive}
              maxLength={2000}
              onChange={(e) => setDirective(e.target.value)}
            />
          </div>
          {gen.phase === 'generating' ? (
            <button className="stop-btn" onClick={() => void window.inkcraft.aiCancel(gen.phase === 'generating' ? gen.requestId : '')}>
              ■ 停止生成
            </button>
          ) : (
            <button disabled={!chapter || !continueModel} onClick={() => void startContinue()}>
              续写（Ctrl+Enter）
            </button>
          )}
          {gen.phase === 'generating' && <p className="streaming">正在流式生成，内容实时插入正文末尾…</p>}
          {gen.phase === 'done' && (
            <div className="gen-result">
              <p className="ok">
                完成：输入 ≈{gen.usage.promptTokens} / 输出 ≈{gen.usage.completionTokens} tokens（估算）
              </p>
              <div className="gen-actions">
                <button onClick={acceptDraft}>采纳</button>
                <button className="danger" onClick={() => void rollbackContinue()}>
                  回滚本次
                </button>
              </div>
            </div>
          )}
          {gen.phase === 'error' && <p className="error">{gen.message}</p>}

          <h3>划词工具</h3>
          {polishModel && polishProvider ? (
            <p className="model-line">
              {polishProvider.name} · {polishModel.model}
            </p>
          ) : (
            <p className="model-line">提示：需在设置中配置「润色 / 扩写」场景模型</p>
          )}
          {polish.phase === 'idle' ? (
            <p className="ai-panel-hint">选中正文中的文字，浮出菜单：润色 / 改写 / 扩写 / 缩写</p>
          ) : (
            <div className="polish-box">
              <div className="polish-head">
                {POLISH_LABELS[polish.operation]}
                {polish.phase === 'generating' ? '中…' : '结果'}
              </div>
              <pre className="polish-result">{polish.result || '…'}</pre>
              <div className="gen-actions">
                {polish.phase === 'generating' ? (
                  <button
                    className="stop-btn"
                    onClick={() =>
                      void window.inkcraft.aiCancel(polish.requestId ?? '')
                    }
                  >
                    ■ 停止
                  </button>
                ) : (
                  <>
                    <button onClick={() => void applyPolish()}>替换选区</button>
                    <button
                      className="ghost"
                      onClick={() =>
                        setPolish({ phase: 'idle', operation: polish.operation, selection: '', result: '' })
                      }
                    >
                      丢弃
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <h3>本章归档（记忆）</h3>
          <p className="ai-panel-hint">
            归档生成摘要后：后续章节续写用摘要替代原文尾巴（省 token），本章正文与摘要写入 RAG 索引。
          </p>
          {chapter ? (
            <div className="archive-box">
              <textarea
                className="summary-textarea"
                rows={6}
                placeholder="点击「AI 生成摘要」产出本章记忆摘要，可编辑后保存归档"
                value={summaryText}
                disabled={summaryPhase === 'generating'}
                onChange={(e) => {
                  setSummaryText(e.target.value)
                  setSummaryPhase('dirty')
                }}
              />
              <div className="gen-actions">
                {summaryPhase === 'generating' ? (
                  <button
                    className="stop-btn"
                    onClick={() => void window.inkcraft.aiCancel(summarizeReqRef.current ?? '')}
                  >
                    ■ 停止
                  </button>
                ) : (
                  <button onClick={() => void startSummarize()}>AI 生成摘要</button>
                )}
                <button
                  disabled={!summaryText.trim() || summaryPhase === 'generating'}
                  onClick={() => void saveSummary()}
                >
                  保存并归档
                </button>
              </div>
              {summaryPhase === 'generating' && <p className="streaming">摘要生成中…</p>}
            </div>
          ) : (
            <p className="ai-panel-hint">先选择章节</p>
          )}

          <h3>RAG 索引</h3>
          {ragStat ? (
            <p className="model-line">
              {ragStat.chunks} 个切片 · 已嵌入 {ragStat.embedded}
              {!ragStat.embeddingConfigured && '（未配置嵌入模型：仅实体检索）'}
            </p>
          ) : (
            <p className="model-line">加载中…</p>
          )}
          <button className="ghost" onClick={() => void rebuildRag()}>
            重建全书索引
          </button>

          <h3>快照</h3>
          <div className="snapshot-row">
            <select value={selectedSnapshot} onChange={(e) => setSelectedSnapshot(e.target.value)}>
              <option value="">选择快照…</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(s.createdAt).toLocaleString()} · {s.title || s.kind}（{s.wordCount}字）
                </option>
              ))}
            </select>
            <button className="ghost" disabled={!selectedSnapshot || busy} onClick={() => void restoreSnapshot()}>
              恢复
            </button>
          </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
