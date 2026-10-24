/**
 * 中文字数统计：每个汉字/全角标点计 1，连续的英文字母或数字串计 1。
 * 口径接近 Word 的"字数"统计（CJK 逐字 + 西文按词）。
 */
export function countWords(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g)
  const latin = text.match(/[a-zA-Z0-9]+/g)
  return (cjk?.length ?? 0) + (latin?.length ?? 0)
}
