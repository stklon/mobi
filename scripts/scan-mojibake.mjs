// Scan source files for UTF-8/GBK mojibake artifacts (edit-race corruption detection)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['packages', 'apps']
const SKIP = ['node_modules', 'dist', 'out', '.pnpm']
// GBK-misdecoded-UTF8 mojibake markers + U+FFFD
const BAD = /[\uFFFD\uE4B6-\uE4B7]|鐢|鍒|銆|绗|鑾|鍝|鏂|鍐|锛|鏄|鐨|涓/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|css|md)$/.test(name)) out.push(p)
  }
  return out
}

let issues = 0
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf-8')
    const m = text.match(BAD)
    if (m) {
      console.log(`MOJIBAKE ${file}: ${JSON.stringify(m[0])}`)
      issues++
    }
  }
}
console.log(issues === 0 ? 'clean: no mojibake found' : `${issues} file(s) suspect`)
