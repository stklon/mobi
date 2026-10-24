// 只读检查应用的 RAG 实际状态：Provider 配置 / 嵌入场景 / 切片与向量数
const Database = require('better-sqlite3')
const os = require('node:os')
const path = require('node:path')

const dbPath = path.join(os.homedir(), 'AppData/Roaming/@inkcraft/desktop/data/library.db')
const db = new Database(dbPath, { readonly: true })

const readSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? JSON.parse(row.value) : null
}

console.log('=== Provider ===')
const providers = readSetting('providers') || []
for (const p of providers) {
  console.log(
    `- ${p.name} | ${p.protocol} | key:${p.apiKeyEnc ? '已配置' : '无'} | models:${(p.models || []).length}个` +
      (p.models || []).slice(0, 8).join(',').replace(/^/, ' ') + ((p.models || []).length > 8 ? ' …' : '')
  )
}

console.log('\n=== 模型分工 ===')
const modelConfig = readSetting('modelConfig') || {}
const providerName = (id) => providers.find((p) => p.id === id)?.name ?? '?'
for (const [scene, cfg] of Object.entries(modelConfig)) {
  console.log(`- ${scene}: ${providerName(cfg.providerId)} / ${cfg.model}`)
}
if (!modelConfig.embedding) console.log('- embedding: （未配置 → RAG 仅实体检索）')

console.log('\n=== 数据与索引 ===')
const q = (sql) => db.prepare(sql).get()
console.log(`- 章节: ${q('SELECT COUNT(*) c FROM chapters').c} 章`)
console.log(`- 摘要: ${q('SELECT COUNT(*) c FROM summaries').c} 条`)
const chunks = q('SELECT COUNT(*) c FROM chunks').c
const embedded = q('SELECT COUNT(*) c FROM chunks WHERE embedding IS NOT NULL').c
console.log(`- RAG 切片: ${chunks} 片，已嵌入向量: ${embedded} 片`)
const byType = db.prepare('SELECT source_type, COUNT(*) c FROM chunks GROUP BY source_type').all()
for (const r of byType) console.log(`  · ${r.source_type}: ${r.c}`)

console.log('\n=== 结论 ===')
if (chunks === 0) {
  console.log('索引为空：还没有章节归档过。走"AI 生成摘要→保存并归档"，或点「重建全书索引」。')
} else if (embedded === 0) {
  console.log('切片存在但无向量：嵌入场景配置后需点「重建全书索引」补嵌入。')
} else if (modelConfig.embedding) {
  console.log(`RAG 双通道已生效（实体 + 向量，${embedded}/${chunks} 已嵌入）。`)
} else {
  console.log('切片已带向量但嵌入场景未配置？(异常，检查设置)')
}
db.close()
