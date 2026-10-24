import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterDTO, ChapterMetaDTO, ProjectDTO, VolumeDTO } from '@inkcraft/shared'
import { countWords } from '@inkcraft/core'
import { ChapterEditor } from '../components/ChapterEditor'

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

export function Workbench({ project, onBack }: Props) {
  const [volumes, setVolumes] = useState<VolumeDTO[]>([])
  const [chapters, setChapters] = useState<ChapterMetaDTO[]>([])
  const [volumeId, setVolumeId] = useState('')
  const [chapter, setChapter] = useState<ChapterDTO | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const pendingRef = useRef<PendingSave | null>(null)

  const loadChapters = useCallback(async () => {
    setChapters(await window.inkcraft.chapterList(project.id))
  }, [project.id])

  useEffect(() => {
    void (async () => {
      const vols = await window.inkcraft.volumeList(project.id)
      setVolumes(vols)
      setVolumeId(vols[0]?.id ?? '')
      await loadChapters()
    })()
  }, [project.id, loadChapters])

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

  const openChapter = async (id: string): Promise<void> => {
    await flushSave()
    const c = await window.inkcraft.chapterGet(id)
    if (c) {
      setChapter(c)
      setTitle(c.title)
      setContent(c.content)
      setSaveState('saved')
    }
  }

  const addChapter = async (): Promise<void> => {
    if (!volumeId) return
    await flushSave()
    const c = await window.inkcraft.chapterCreate({ projectId: project.id, volumeId })
    await loadChapters()
    setChapter(c)
    setTitle(c.title)
    setContent(c.content)
    setSaveState('saved')
  }

  const visibleChapters = chapters.filter((c) => c.volumeId === volumeId)
  const currentWordCount = countWords(content)

  return (
    <div className="workbench">
      <header className="workbench-header">
        <button className="ghost" onClick={() => void flushSave().then(onBack)}>
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
            <button onClick={() => void addChapter()} disabled={!volumeId}>
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
            {visibleChapters.length === 0 && <li className="chapter-empty">暂无章节，点击「+ 新章」开始创作</li>}
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
          <h3>AI 面板</h3>
          <p className="ai-panel-hint">M2 里程碑接入：</p>
          <ul>
            <li>模型 Provider 配置</li>
            <li>提示词模板引擎</li>
            <li>RAG 上下文组装</li>
            <li>流式续写（Ctrl+Enter）</li>
          </ul>
        </aside>
      </div>
    </div>
  )
}
