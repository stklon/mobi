import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor, JSONContent } from '@tiptap/react'
import { Mark } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { PolishOperation } from '@inkcraft/shared'

/** AI 生成内容的草稿态高亮（仅会话内有效，不入库——docToText 只取纯文本） */
const AiDraftMark = Mark.create({
  name: 'aiDraft',
  renderHTML() {
    return ['span', { class: 'ai-draft' }, 0]
  }
})

/**
 * 章节正文的纯文本 <-> TipTap 文档双向转换。
 * 存储层始终是纯文本（换行 = 段落分隔），便于导出与 RAG 切片。
 */
function textToDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : []
    }))
  }
}

function docToText(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((block) => (block.content ?? []).map((node) => node.text ?? '').join(''))
    .join('\n')
}

/** 在文档末尾追加一段 AI 草稿文本并高亮（每次 chunk 一个事务） */
export function appendDraftText(editor: Editor, text: string): void {
  const { tr, doc, schema } = editor.state
  const end = doc.content.size
  editor.view.dispatch(
    tr.insertText(text, end).addMark(end, end + text.length, schema.marks.aiDraft.create())
  )
  editor.commands.scrollIntoView()
}

/** 整体替换编辑器内容（快照恢复 / 润色替换选区后同步） */
export function setEditorContent(editor: Editor, text: string): void {
  editor.commands.setContent(textToDoc(text))
}

/** 采纳 AI 草稿：清除全部草稿高亮 */
export function clearDraftMarks(editor: Editor): void {
  const { tr, doc, schema } = editor.state
  editor.view.dispatch(tr.removeMark(0, doc.content.size, schema.marks.aiDraft))
}

export interface SelectionInfo {
  selection: string
  contextBefore: string
}

interface Props {
  /** 章节切换的信号：仅当 id 变化时重置编辑器内容，编辑过程中的 content 变化不回写 */
  chapterId: string
  content: string
  onContentChange: (text: string) => void
  /** 暴露编辑器实例给工作台（流式插入/内容替换） */
  editorRef?: React.RefObject<Editor | null>
  /** 划词菜单触发 */
  onPolishRequest?: (operation: PolishOperation, info: SelectionInfo) => void
}

export function ChapterEditor({ chapterId, content, onContentChange, editorRef, onPolishRequest }: Props) {
  // useEditor 的 options 仅在挂载时生效，用 ref 转发避免 onUpdate 闭包过期
  const onChangeRef = useRef(onContentChange)
  onChangeRef.current = onContentChange
  const polishRef = useRef(onPolishRequest)
  polishRef.current = onPolishRequest

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 小说正文为纯文本段落模型：关闭全部格式化与列表扩展
        // 保留：document / paragraph / text / undoRedo / dropcursor
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false,
        trailingNode: false
      }),
      AiDraftMark
    ],
    content: textToDoc(content),
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(docToText(e.getJSON()))
    }
  })

  useEffect(() => {
    if (editorRef) editorRef.current = editor
  }, [editor, editorRef])

  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(textToDoc(content))
    // content 故意不在依赖里：只在切换章节时整体重置，避免打字过程被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, editor])

  const startPolish = (operation: PolishOperation): void => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const selection = editor.state.doc.textBetween(from, to, '\n')
    const contextBefore = editor.state.doc.textBetween(Math.max(0, from - 300), from, '\n')
    editor.commands.focus()
    polishRef.current?.(operation, { selection, contextBefore })
  }

  return (
    <>
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ state }) => !state.selection.empty}
          options={{ placement: 'top', offset: 8 }}
        >
          <div className="bubble-menu">
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                startPolish('polish')
              }}
            >
              润色
            </button>
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                startPolish('rewrite')
              }}
            >
              改写
            </button>
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                startPolish('expand')
              }}
            >
              扩写
            </button>
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                startPolish('shorten')
              }}
            >
              缩写
            </button>
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} className="chapter-editor" />
    </>
  )
}
