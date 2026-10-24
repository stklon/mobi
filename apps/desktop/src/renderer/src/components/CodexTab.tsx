import { useCallback, useEffect, useState } from 'react'
import type { CodexEntryDTO, CodexType } from '@inkcraft/shared'
import { CODEX_TYPES } from '@inkcraft/core'

interface Props {
  projectId: string
}

const TYPE_LABELS: Record<CodexType, string> = {
  world: '世界观',
  character: '角色',
  location: '地点',
  faction: '势力',
  item: '物品',
  rule: '规则',
  custom: '自定义'
}

interface CodexForm {
  id?: string
  name: string
  type: CodexType
  aliases: string
  importance: 'pinned' | 'retrieval'
  content: string
}

const EMPTY_FORM: CodexForm = { name: '', type: 'character', aliases: '', importance: 'retrieval', content: '' }

/** 工作台右栏「设定」标签页：Codex 条目管理（M3 为检索/常驻注入的数据源） */
export function CodexTab({ projectId }: Props) {
  const [entries, setEntries] = useState<CodexEntryDTO[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const [form, setForm] = useState<CodexForm | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setEntries(await window.inkcraft.codexList(projectId, typeFilter || undefined))
  }, [projectId, typeFilter])

  useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = (): void => {
    setForm({ ...EMPTY_FORM, type: (typeFilter || 'character') as CodexType })
    setError('')
  }

  const openEdit = (e: CodexEntryDTO): void => {
    setForm({
      id: e.id,
      name: e.name,
      type: e.type,
      aliases: e.aliases.join('、'),
      importance: e.importance,
      content: e.content
    })
    setError('')
  }

  const save = async (): Promise<void> => {
    if (!form) return
    const aliases = form.aliases
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      if (form.id) {
        await window.inkcraft.codexUpdate({ id: form.id, name: form.name, type: form.type, aliases, content: form.content, importance: form.importance })
      } else {
        await window.inkcraft.codexCreate({ projectId, type: form.type, name: form.name, aliases, content: form.content, importance: form.importance })
      }
      setForm(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (e: CodexEntryDTO): Promise<void> => {
    if (!window.confirm(`确定删除设定「${e.name}」？`)) return
    await window.inkcraft.codexDelete(e.id)
    await reload()
  }

  return (
    <div className="codex-tab">
      <div className="codex-toolbar">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">全部类型</option>
          {CODEX_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button onClick={openCreate}>+ 新增</button>
      </div>

      {form && (
        <div className="codex-form">
          <div className="codex-form-row">
            <input
              placeholder="名称"
              value={form.name}
              maxLength={50}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CodexType })}>
              {CODEX_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <input
            placeholder="别名（用、分隔，章纲引用与角色匹配用）"
            value={form.aliases}
            onChange={(e) => setForm({ ...form, aliases: e.target.value })}
          />
          <select
            value={form.importance}
            onChange={(e) => setForm({ ...form, importance: e.target.value as 'pinned' | 'retrieval' })}
          >
            <option value="retrieval">检索注入（按需）</option>
            <option value="pinned">常驻注入（每次续写都带上）</option>
          </select>
          <textarea
            placeholder="设定正文（Markdown）"
            rows={8}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
          <div className="codex-form-actions">
            <button disabled={!form.name.trim()} onClick={() => void save()}>
              保存
            </button>
            <button className="ghost" onClick={() => setForm(null)}>
              取消
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      <ul className="codex-list">
        {entries.map((e) => (
          <li key={e.id} className="codex-item">
            <div className="codex-item-head" onClick={() => openEdit(e)}>
              <span className="codex-item-name">{e.name}</span>
              <span className="tag">{TYPE_LABELS[e.type]}</span>
              {e.importance === 'pinned' && <span className="pinned-badge">常驻</span>}
            </div>
            {e.aliases.length > 0 && <div className="codex-item-aliases">又称：{e.aliases.join('、')}</div>}
            <div className="codex-item-content">{e.content.slice(0, 80) || '（空）'}</div>
            <div className="codex-item-actions">
              <button className="ghost" onClick={() => openEdit(e)}>
                编辑
              </button>
              <button className="danger" onClick={() => void remove(e)}>
                删除
              </button>
            </div>
          </li>
        ))}
        {entries.length === 0 && <li className="settings-empty">暂无设定。建议至少添加一条「世界观」常驻设定。</li>}
      </ul>
    </div>
  )
}
