export interface ExportChapter {
  volumeTitle: string
  no: number
  title: string
  content: string
}

/** 组装导出 txt 的全文（纯函数，冒烟可测；卷/章按序号排序，CRLF 分段） */
export function buildExportText(bookTitle: string, chapters: ExportChapter[]): string {
  const parts: string[] = [bookTitle, '']
  let lastVolume = ''
  for (const c of chapters) {
    if (c.volumeTitle !== lastVolume) {
      parts.push('', `【${c.volumeTitle}】`, '')
      lastVolume = c.volumeTitle
    }
    parts.push(`第${c.no}章 ${c.title}`, '', c.content.trim(), '')
  }
  return parts.join('\r\n').replace(/\r\n{3,}/g, '\r\n\r\n').trim() + '\r\n'
}
