// 用 ZCode 宿主的 OAuth token 探测 Z.ai 端点可用性（token 不打印）
import { readFileSync } from 'node:fs'

const cred = JSON.parse(
  readFileSync('C:/Users/Administrator/.zcode/v2/credentials.json', 'utf-8')
)
const token = cred['oauth:zai:access_token']
if (!token) {
  console.error('NO oauth:zai:access_token in credentials')
  process.exit(1)
}
console.log(`token loaded: ${String(token).slice(0, 8)}*** (${String(token).length} chars)`)

async function probe(name, url, headers, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    })
    const text = await res.text()
    console.log(`\n[${name}] ${res.status} ${res.statusText}`)
    console.log(text.slice(0, 300).replace(/\s+/g, ' '))
  } catch (err) {
    console.log(`\n[${name}] FETCH-FAIL: ${err.message}`)
  }
}

const anthropicBody = {
  model: 'GLM-5.3-Flash',
  max_tokens: 32,
  stream: false,
  messages: [{ role: 'user', content: '只回复两个字：成功' }]
}
const openaiBody = {
  model: 'GLM-5.3-Flash',
  max_tokens: 32,
  messages: [{ role: 'user', content: '只回复两个字：成功' }]
}

// 1. Anthropic 协议 + Bearer
await probe(
  'anthropic/bearer',
  'https://api.z.ai/api/anthropic/v1/messages',
  { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01' },
  anthropicBody
)

// 2. Anthropic 协议 + x-api-key
await probe(
  'anthropic/x-api-key',
  'https://api.z.ai/api/anthropic/v1/messages',
  { 'x-api-key': token, 'anthropic-version': '2023-06-01' },
  anthropicBody
)

// 3. OpenAI 协议 + Bearer（预期可能 401，仅验证）
await probe(
  'openai/bearer',
  'https://api.z.ai/api/paas/v4/chat/completions',
  { Authorization: `Bearer ${token}` },
  openaiBody
)
