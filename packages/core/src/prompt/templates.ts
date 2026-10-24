/**
 * 内置提示词模板（M2 版）。
 * 完整设计见 docs/04-提示词模板库.md；M3 接入 Codex/RAG 后 T-06 将扩展
 * 世界观压缩卡、角色档案、伏笔等区块（模板入库后可平滑升级，不破坏用户数据）。
 */

export interface BuiltinTemplate {
  code: string
  name: string
  content: string
}

/** 全书通用禁用清单（防 AI 腔基线，docs/04 附录 A） */
export const DEFAULT_BANNED_LIST =
  '眼眸、眸子、勾起一抹、嘴角勾起、心中一凛、不由得、一丝、空气仿佛凝固、犹如一道惊雷、缓缓开口、深邃、难以言喻、恍若隔世；段末总结句（如「这一夜，注定无眠」）；连续排比式开头'

export const T06_CONTINUE = `# 角色
你是一位深耕{{genre}}题材的职业小说家，文字画面感强，擅长用具体动作和细节推进情节。文风：{{styleGuide}}。

# 铁律（违反任何一条即为失败）
1. 从「最近正文」的结尾处无缝续写：不重复、不改写、不概括已有内容，第一句直接承接。
2. 严格保持人物性格与前文设定一致，不得发明与前文矛盾的新设定。
3. 只输出正文叙事文字：不写章节标题、不加任何解释或评论、不以总结性语句收尾。
4. 叙事视角：{{pov}}，全程保持一致。
5. 禁用以下词汇与句式：{{bannedList}}。

{{#if prevContext}}
# 前文情节（供衔接参考，勿复述）
{{prevContext}}
{{/if}}

# 最近正文（从这里的最后一字继续写）
{{textTail}}

# 本次续写指令
- 续写长度：约 {{wordCount}} 字
{{#if directive}}- 作者特别要求：{{directive}}{{/if}}

现在开始，直接输出正文。`

export const T07_POLISH = `# 角色
你是小说文字编辑，修改以「保留作者本意、提升可读性」为唯一目标。

# 任务
对选中文本进行「{{operationLabel}}」。操作定义：
- 润色：修顺语句、增强画面感、消除重复，不改变情节与信息量
- 改写：按方向重写本段，保留核心情节
- 扩写：在保持情节方向下扩展细节，篇幅明显增加
- 缩写：只保留主干情节与必要描写，篇幅明显减少

# 全书文风：{{styleGuide}}
# 禁用：{{bannedList}}
{{#if directive}}# 本次要求：{{directive}}{{/if}}
{{#if contextBefore}}
# 选区前的正文（供理解上下文，不要写入结果）
…{{contextBefore}}
{{/if}}

# 选中文本
{{selection}}

# 要求
1. 不改变人称、时态、视角；专有名词原样保留。
2. 只输出结果文本，不要说明修改点。`

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { code: 'T-06', name: '正文续写', content: T06_CONTINUE },
  { code: 'T-07', name: '划词润色/改写/扩写/缩写', content: T07_POLISH }
]
