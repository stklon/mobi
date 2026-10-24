// 检查 enc:v1 payload 的编码格式（内容已加密，前缀展示无泄露风险）
import { readFileSync } from 'node:fs'

const cred = JSON.parse(readFileSync('C:/Users/Administrator/.zcode/v2/credentials.json', 'utf-8'))
const raw = cred['oauth:zai:access_token']
const payload = raw.slice(7) // strip enc:v1:
console.log('payload length:', payload.length)
console.log('first 32 chars:', payload.slice(0, 32))
console.log('charset sample:', [...new Set(payload.slice(0, 200))].join(''))
const hasUrlSafe = /[-_]/.test(payload)
const hasPlusSlash = /[+/]/.test(payload)
console.log('urlsafe(-,_):', hasUrlSafe, ' standard(+,/):', hasPlusSlash)

// 试 base64url 解码
try {
  const norm = payload.replace(/-/g, '+').replace(/_/g, '/')
  const buf = Buffer.from(norm, 'base64')
  console.log('decoded bytes:', buf.length, 'head hex:', buf.subarray(0, 8).toString('hex'))
} catch (e) {
  console.log('b64 decode fail:', e.message)
}
