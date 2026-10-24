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

export function Bookshelf({ onOpen, onStartWizard, onOpenSettings }: Props) {
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [info, setInfo] = useState<AppInfoDTO | null>(null)
  const [form, setForm] = useState<CreateProjectPayload>({ title: '', genre: '玄幻' })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

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
