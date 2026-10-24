import type { Database } from 'better-sqlite3'
import type { ExportChapter } from '@inkcraft/core'
import { buildExportText } from '@inkcraft/core'

/**
 * 导出服务：txt（平台通用分段）与 docx（标题样式）。
 * 文本组装的纯函数在 packages/core（export/text.ts），冒烟可测。
 */
export class ExportService {
  constructor(private readonly db: Database) {}

  getChapters(projectId: string, volumeId?: string): ExportChapter[] {
    const rows = volumeId
      ? (this.db
          .prepare(
            `SELECT c.no, c.title, c.content, v.title AS volume_title
             FROM chapters c JOIN volumes v ON v.id = c.volume_id
             WHERE c.project_id = ? AND c.volume_id = ?
             ORDER BY c.no`
          )
          .all(projectId, volumeId) as Array<{ no: number; title: string; content: string; volume_title: string }>)
      : (this.db
          .prepare(
            `SELECT c.no, c.title, c.content, v.title AS volume_title
             FROM chapters c JOIN volumes v ON v.id = c.volume_id
             WHERE c.project_id = ?
             ORDER BY c.no`
          )
          .all(projectId) as Array<{ no: number; title: string; content: string; volume_title: string }>)
    return rows.map((r) => ({ volumeTitle: r.volume_title, no: r.no, title: r.title, content: r.content }))
  }

  async exportTxt(bookTitle: string, chapters: ExportChapter[], filePath: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(filePath, buildExportText(bookTitle, chapters), 'utf-8')
  }

  async exportDocx(bookTitle: string, chapters: ExportChapter[], filePath: string): Promise<void> {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx')
    const children: import('docx').Paragraph[] = [
      new Paragraph({ text: bookTitle, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER })
    ]
    let lastVolume = ''
    for (const c of chapters) {
      if (c.volumeTitle !== lastVolume) {
        children.push(new Paragraph({ text: c.volumeTitle, heading: HeadingLevel.HEADING_1 }))
        lastVolume = c.volumeTitle
      }
      children.push(new Paragraph({ text: `第${c.no}章 ${c.title}`, heading: HeadingLevel.HEADING_2 }))
      for (const para of c.content.split('\n')) {
        if (!para.trim()) continue
        children.push(new Paragraph({ children: [new TextRun({ text: para, size: 24 })] }))
      }
    }
    const doc = new Document({ sections: [{ children }] })
    const buffer = await Packer.toBuffer(doc)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(filePath, buffer)
  }

  /** 生成默认文件名（不含扩展名） */
  static defaultFileName(bookTitle: string): string {
    const safe = bookTitle.replace(/[\\/:*?"<>|]/g, '_')
    const d = new Date()
    return `${safe}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  }
}
