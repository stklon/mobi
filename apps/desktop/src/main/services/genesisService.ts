import type { GenesisParams, OutlineBatchParams } from '@inkcraft/shared'
import { genesisParamsSchema, outlineBatchParamsSchema } from '@inkcraft/core'
import type { LibraryService } from './libraryService'
import type { CodexService } from './codexService'
import type { OutlineService } from './outlineService'
import type { TemplateService } from './templateService'

export interface GenesisPromptResult {
  prompt: string
  templateCode: string
  temperature: number
  maxTokens: number
}

const cap = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`

/**
 * 创世向导与批量章纲的提示词构建。
 * 创世三步（世界观/角色/总纲）+ 卷级批量章纲（T-05，JSON 输出由渲染层解析确认）。
 */
export class GenesisService {
  constructor(
    private readonly library: LibraryService,
    private readonly codex: CodexService,
    private readonly outline: OutlineService,
    private readonly templates: TemplateService
  ) {}

  buildGenesisPrompt(params: GenesisParams): GenesisPromptResult {
    const input = genesisParamsSchema.parse(params)
    const project = this.library.getProject(input.projectId)
    if (!project) throw new Error('作品不存在')

    if (input.step === 'world') {
      const { prompt } = this.templates.render('T-01', {
        genre: project.genre || '大众小说',
        idea: input.input.idea,
        styleKeywords: input.input.styleKeywords,
        hasGoldenFinger: input.input.hasGoldenFinger ? '1' : ''
      })
      return { prompt, templateCode: 'T-01', temperature: 0.9, maxTokens: 4096 }
    }

    if (input.step === 'characters') {
      const worldContent =
        input.input.worldContent?.trim() ||
        this.codex
          .listPinned(project.id)
          .map((e) => e.content)
          .join('\n\n') ||
        '（世界观尚未生成，请基于题材合理构建）'
      const { prompt } = this.templates.render('T-02', {
        count: input.input.characterCount ?? 4,
        worldContent: cap(worldContent, 4000)
      })
      return { prompt, templateCode: 'T-02', temperature: 0.9, maxTokens: 4096 }
    }

    // step === 'outline'
    const worldContent =
      input.input.worldContent?.trim() ||
      this.codex
        .listPinned(project.id)
        .map((e) => e.content)
        .join('\n\n') ||
      '（世界观尚未生成）'
    const charactersContent =
      input.input.charactersContent?.trim() ||
      this.codex
        .list(project.id, 'character')
        .map((e) => `【${e.name}】\n${cap(e.content, 600)}`)
        .join('\n\n') ||
      '（主要角色尚未生成）'
    const { prompt } = this.templates.render('T-03', {
      worldContent: cap(worldContent, 4000),
      charactersContent: cap(charactersContent, 3000),
      genre: project.genre || '大众小说',
      theme: input.input.theme ?? '',
      targetWords: project.targetWords || 2_000_000
    })
    return { prompt, templateCode: 'T-03', temperature: 0.8, maxTokens: 4096 }
  }

  buildOutlineBatchPrompt(params: OutlineBatchParams): GenesisPromptResult {
    const input = outlineBatchParamsSchema.parse(params)
    const project = this.library.getProject(input.projectId)
    if (!project) throw new Error('作品不存在')

    const bookNode = this.outline.getBook(input.projectId)
    const volumeNode = this.outline.getVolume(input.volumeId)
    const volume = this.library.listVolumes(input.projectId).find((v) => v.id === input.volumeId)
    const existing = this.outline
      .listChapters(input.projectId)
      .filter((n) => n.chapterNo !== null && n.chapterNo < input.startNo)
      .slice(-10)
      .map(
        (n) =>
          `第${n.chapterNo}章 ${n.title}：${n.goal}${n.endingHook ? `（钩子：${n.endingHook}）` : ''}`
      )
      .join('\n')

    const { prompt } = this.templates.render('T-05', {
      bookOutline: cap(bookNode?.content ?? '（总纲尚未生成）', 3000),
      volumeOutline: cap(volumeNode?.content ?? `（本卷「${volume?.title ?? ''}」尚无卷纲，按总纲推进）`, 2000),
      existingOutlines: existing || '（无，本批为第一批章纲）',
      startNo: input.startNo,
      endNo: input.startNo + input.count - 1,
      count: input.count
    })
    return { prompt, templateCode: 'T-05', temperature: 0.8, maxTokens: 8192 }
  }
}
