/**
 * Token 粗略估算（仅用于预算控制与用量展示，不追求精确）：
 * 中文主流模型约 1.5 字/token，西文约 1.3 token/词，故保守按字数折算。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/g)?.length ?? 0
  const latin = text.match(/[a-zA-Z0-9]+/g)?.length ?? 0
  return Math.ceil(cjk / 1.5 + latin * 1.3)
}
