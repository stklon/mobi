import { useCallback, useEffect, useState } from 'react'
import type { AppInfoDTO, CreateProjectPayload, ProjectDTO } from '@inkcraft/shared'
import { GENRES } from '@inkcraft/core'

interface Props {
  onOpen: (project: ProjectDTO) => void
  onStartWizard: (project: ProjectDTO) => void
  onOpenSettings: () => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WELCOME_KEY = 'inkcraft.welcomed'

export function Bookshelf({ onOpen, onStartWizard, onOpenSettings }: Props) {
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [info, setInfo] = useState<AppInfoDTO | null>(null)
  const [form, setForm] = useState<CreateProjectPayload>({ title: '', genre: '玄幻' })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem(WELCOME_KEY))

  const dismissWelcome = (): void => {
    localStorage.setItem(WELCOME_KEY, '1')
    setShowWelcome(false)
  }

  const refresh = useCallback(async () => {
    setProjects(await window.inkcraft.projectList())
  }, [])

  useEffect(() => {
    void refresh()
    void window.inkcraft.appInfo().then(setInfo)
  }, [refresh])

  const create = async (): Promise<void> => {
    setCreating(true)
    setError('')
    try {
      const project = await window.inkcraft.projectCreate(form)
      onStartWizard(project) // 新书进入创世向导
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const remove = async (project: ProjectDTO): Promise<void> => {
    if (!window.confirm(`确定删除《${project.title}》？该操作不可恢复。`)) return
    await window.inkcraft.projectDelete(project.id)
    void refresh()
  }

  const exportBook = async (project: ProjectDTO, format: 'txt' | 'docx'): Promise<void> => {
    try {
      const res = await window.inkcraft.exportRun({ projectId: project.id, format })
      if (res.ok && res.path) window.alert(`已导出：${res.path}`)
      else if (res.error && res.error !== '已取消') window.alert(`导出失败：${res.error}`)
    } catch (e) {
      window.alert(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="bookshelf">
      <header className="bookshelf-header">
        <div>
          <h1>墨匠 InkCraft</h1>
          <span className="subtitle">AI 长篇小说创作工坊</span>
        </div>
        <button className="ghost" onClick={onOpenSettings}>
          ⚙ 设置
        </button>
      </header>

      {showWelcome && (
        <section className="welcome-card">
          <h2>欢迎使用墨匠 InkCraft</h2>
          <p className="welcome-sub">三步开始你的第一部 AI 长篇：</p>
          <ol className="welcome-steps">
            <li>
              在 <b>设置 → 模型服务</b> 添加 API（DeepSeek / 智谱 / Kimi / 通义 / 本地 Ollama 均可），
              并在 <b>模型分工</b> 为「创世 / 续写 / 润色 / 摘要」各选一个模型。
            </li>
            <li>
              <b>新建作品</b> 进入创世向导：一句话创意 → AI 生成世界观、角色、总纲（每步可改）。
            </li>
            <li>
              写作中 <b>Ctrl+Enter</b> 流式续写（自动携带世界观/角色/章纲）；每写完一章，
              在 AI 面板<b>「生成摘要并归档」</b>——AI 会记住你的整个故事。
            </li>
          </ol>
          <div className="welcome-actions">
            <button onClick={onOpenSettings}>① 去配置模型</button>
            <button className="ghost" onClick={dismissWelcome}>
              开始使用
            </button>
          </div>
        </section>
      )}

      <section className="create-card">
        <h2>新建作品</h2>
        <div className="create-form">
          <input
            placeholder="书名（必填）"
            value={form.title}
            maxLength={60}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && form.title.trim()) void create()
            }}
          />
          <select value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <button disabled={!form.title.trim() || creating} onClick={() => void create()}>
            {creating ? '创建中…' : '开写'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="project-grid">
        {projects.length === 0 && <p className="empty">书架空空如也，从上面开始你的第一部作品吧。</p>}
        {projects.map((p) => (
          <div key={p.id} className="project-card">
            <div className="project-card-body" onClick={() => onOpen(p)}>
              <div className="project-title">{p.title}</div>
              <div className="project-meta">
                <span className="tag">{p.genre || '未分类'}</span>
                <span>创建于 {formatDate(p.createdAt)}</span>
              </div>
            </div>
            <div className="project-card-actions">
              <button onClick={() => onOpen(p)}>打开</button>
              <button className="ghost" onClick={() => void exportBook(p, 'txt')}>
                导出 txt
              </button>
              <button className="ghost" onClick={() => void exportBook(p, 'docx')}>
                导出 docx
              </button>
              <button className="danger" onClick={() => void remove(p)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </section>

      {info && (
        <footer className="bookshelf-footer">
          v{info.version} · 数据目录：{info.dbPath}
        </footer>
      )}
    </div>
  )
}
