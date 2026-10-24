// 扫描 zcode-builtin.json 导出的日志，提取 embedding / coding 相关端点与模型信息
import { readFileSync } from 'node:fs'

const LOG = 'C:/Users/Administrator/AppData/Local/Temp/zcode-bash-DextWN/session_45f41ead17b53522536a23e39fac448d/call_5c9a53fd2c2c4060a078e088-stdout.log'
const text = readFileSync(LOG, 'utf-8')

for (const kw of ['embedding', 'Embedding', 'coding', '/api/paas/v4', '/api/anthropic']) {
  let idx = 0
  let count = 0
  while (count < 4) {
    idx = text.indexOf(kw, idx)
    if (idx === -1) break
    const snippet = text
      .slice(Math.max(0, idx - 100), idx + 180)
      .replace(/[\r\n]+/g, ' ')
    console.log(`[${kw}] …${snippet}…`)
    idx += kw.length
    count++
  }
  if (count === 0) console.log(`[${kw}] (no match)`)
}
