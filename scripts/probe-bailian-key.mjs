// 验证 secrets.env.local 里的 Key 在哪个端点配置下可用，并给出可直接使用的 Provider 配置。
// 用法：node scripts/probe-bailian-key.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SECRETS = join(ROOT, 'secrets.env.local')

if (!existsSync(SECRETS)) {
  console.error('未找到 secrets.env.local（可从 secrets.env.local.example 复制并填入 Key）')
  process.exit(1)
}

const env = {}
for (const line of readFileSync(SECRETS, 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const key = env.BAILIAN_API_KEY || env.BAILIAN_CODING_KEY
if (!key || key.includes('填入')) {
  console.error('secrets.env.local 中未找到有效的 BAILIAN_API_KEY')
  process.exit(1)
}

/** 端点候选：Key 前缀 ↔ 协议/端点配对（官方文档 get-api-key 页对照表） */
const CANDIDATES = [
  {
    name: '百炼 Coding Plan（sk-ws- Key 专属）',
    protocol: 'anthropic',
    url: 'https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: { model: 'qwen3.7-plus', max_tokens: 16, messages: [{ role: 'user', content: '只回复：OK' }] }
  },
  {
    name: '阿里百炼（按量付费标准端点）',
    protocol: 'openai',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}` },
    body: { model: 'qwen-plus', max_tokens: 16, messages: [{ role: 'user', content: '只回复：OK' }] }
  },
  {
    name: '百炼 Coding Plan（OpenAI 兼容路径）',
    protocol: 'openai',
    url: 'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}` },
    body: { model: 'qwen3.7-plus', max_tokens: 16, messages: [{ role: 'user', content: '只回复：OK' }] }
  }
]

let working = null
for (const c of CANDIDATES) {
  try {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...c.headers },
      body: JSON.stringify(c.body),
      signal: AbortSignal.timeout(60_000)
    })
    const text = await res.text()
    const ok = res.ok && !text.includes('invalid_api_key') && !text.includes('token expired')
    console.log(`[${ok ? 'OK  ' : 'FAIL'}] ${c.name} → HTTP ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`)
    if (ok && !working) working = c
  } catch (err) {
    console.log(`[FAIL] ${c.name} → ${err.message}`)
  }
}

if (working) {
  const base = working.url.replace(/\/v1\/(messages|chat\/completions)$/, '')
  console.log('\n===== 可用配置（填入应用或 E2E）=====')
  console.log(`Base URL: ${base}`)
  console.log(`协议: ${working.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}`)
  console.log('E2E 命令:')
  const root = ROOT.replace(/\\/g, '/')
  console.log(
    `  cd ${root} && set INKCRAFT_E2E=1 && set INKCRAFT_E2E_BASE_URL=${base} && set INKCRAFT_E2E_PROTOCOL=${working.protocol} && set INKCRAFT_E2E_API_KEY=%BAILIAN_KEY% && set INKCRAFT_E2E_NAME=百炼CodingPlan && set INKCRAFT_E2E_MODELS=qwen3.7-plus,glm-5,kimi-k2.5 && set INKCRAFT_E2E_KEEP=1 && pnpm --filter @inkcraft/desktop start`
  )
} else {
  console.log('\n所有端点均拒绝该 Key。可能原因：临时 Key 已过期（最长 30 分钟）/ 复制不完整 / 已删除。')
  console.log('请在百炼控制台「API-KEY」页创建长期正式 Key（Coding Plan 的 Key 在「我的订阅→Coding Plan」查看配套端点）。')
  process.exit(1)
}
