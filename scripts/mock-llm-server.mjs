// 本地 mock 服务器：同时实现 Anthropic 协议（/v1/messages + /v1/models）
// 与 OpenAI 协议（/chat/completions），用于无 Key 环境下全链路验证应用的双协议支持。
import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT || 8787)
const API_KEY = 'test-key'

const FICTION =
  '夜风卷着松涛掠过山脊。林凡把最后一缕灵气压回丹田，指节在剑柄上轻轻叩了两下。' +
  '三丈外，黑影停在断崖边缘，没有回头。"你终于来了。"那声音像是从石头缝里挤出来的。' +
  '他没有答话，只是缓缓抬起了手中的断剑。剑身上那道裂纹，在月光下像一条活过来的蛇。'

const OUTLINE_JSON = JSON.stringify([
  {
    no: 2,
    title: '夜探藏经阁',
    goal: '林凡潜入藏经阁寻找上古残卷',
    plotPoints: ['翻墙入阁', '遭遇黑影', '夺卷而逃'],
    characters: ['林凡', '苏若雪'],
    endingHook: '黑影摘下斗笠，露出一张熟悉的脸'
  }
])

function pickReply(prompt) {
  if (prompt.includes('严格 JSON') || prompt.includes('章纲')) return OUTLINE_JSON
  return FICTION
}

function sse(res, event, obj) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`)
}

const server = http.createServer((req, res) => {
  const authOk =
    (req.headers['x-api-key'] === API_KEY) ||
    (req.headers.authorization === `Bearer ${API_KEY}`)

  if (req.method === 'GET' && req.url === '/v1/models') {
    if (!authOk) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'GLM-5.3-Flash' }, { id: 'GLM-5.3' }] }))
    return
  }

  if (req.method === 'POST' && (req.url === '/v1/messages' || req.url === '/chat/completions')) {
    if (!authOk) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let prompt = ''
      let model = 'GLM-5.3-Flash'
      try {
        const json = JSON.parse(body)
        model = json.model ?? model
        prompt = (json.messages ?? []).map((m) => m.content ?? '').join('\n')
      } catch {
        /* ignore */
      }
      const reply = pickReply(prompt)
      const chunks = reply.match(/.{1,12}/gs) ?? [reply]
      const isAnthropic = req.url === '/v1/messages'

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })

      if (isAnthropic) {
        sse(res, 'message_start', {
          type: 'message_start',
          message: { model, usage: { input_tokens: 210 } }
        })
        sse(res, 'content_block_start', { type: 'content_block_start', index: 0 })
        let i = 0
        for (const c of chunks) {
          sse(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: c },
            _i: i++
          })
        }
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
        sse(res, 'message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 88 }
        })
        sse(res, 'message_stop', { type: 'message_stop' })
      } else {
        for (const c of chunks) {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
          )
        }
        res.write('data: [DONE]\n\n')
      }
      res.end()
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT} (anthropic + openai protocols)`)
})
