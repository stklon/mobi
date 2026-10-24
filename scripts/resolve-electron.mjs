// Resolve the newest stable Electron version whose ABI is covered by
// better-sqlite3 v12 prebuilds (avoids native compilation on Windows).
const BSQ_TAG = 'v12.12.0'

const rel = await fetch(`https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/${BSQ_TAG}`, {
  headers: { 'User-Agent': 'inkcraft-setup' }
}).then(r => r.json())

const abis = rel.assets
  .map(a => a.name)
  .filter(n => /electron-v\d+-win32-x64\.tar\.gz$/.test(n))
  .map(n => Number(n.match(/electron-v(\d+)-/)[1]))
  .sort((a, b) => b - a)
const maxAbi = abis[0]
console.log('better-sqlite3 electron ABIs (top 6):', abis.slice(0, 6).join(', '))

const releases = await fetch('https://releases.electronjs.org/releases.json').then(r => r.json())
const stable = releases.filter(e => !e.version.includes('-'))
const verNum = v => v.split('.').map(Number)
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

const covered = stable.filter(e => Number(e.modules) <= maxAbi).sort((a, b) => cmp(verNum(b.version), verNum(a.version)))
console.log('Newest stable Electron with prebuild coverage:')
for (const e of covered.slice(0, 3)) {
  console.log(`  electron ${e.version}  (ABI ${e.modules}, node ${e.node}, chrome ${e.chrome})`)
}

const exact = stable.filter(e => Number(e.modules) === maxAbi).sort((a, b) => cmp(verNum(b.version), verNum(a.version)))
if (exact.length) console.log('Exact ABI match:', exact.slice(0, 3).map(e => e.version).join(', '))
