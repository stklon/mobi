import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

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

interface Props {
  /** 章节切换的信号：仅当 id 变化时重置编辑器内容，编辑过程中的 content 变化不回写 */
  chapterId: string
  content: string
  onContentChange: (text: string) => void
}

export function ChapterEditor({ chapterId, content, onContentChange }: Props) {
  // useEditor 的 options 仅在挂载时生效，用 ref 转发避免 onUpdate 闭包过期
  const onChangeRef = useRef(onContentChange)
  onChangeRef.current = onContentChange

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
      })
    ],
    content: textToDoc(content),
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(docToText(e.getJSON()))
    }
  })

  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(textToDoc(content))
    // content 故意不在依赖里：只在切换章节时整体重置，避免打字过程被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, editor])

  return <EditorContent editor={editor} className="chapter-editor" />
}
