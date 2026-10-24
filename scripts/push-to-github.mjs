// 一键推送项目到 GitHub（读取 secrets.env.local 的 GITHUB_TOKEN）
// 流程：验证 token → 获取用户名 → 创建仓库（默认 inkcraft / 私有）→ 推送 main（含全部历史）→ 清理 token
// 用法：node scripts/push-to-github.mjs [仓库名]（默认 inkcraft；环境变量 GITHUB_REPO_PRIVATE=0 建公开库）
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoName = process.argv[2] || process.env.GITHUB_REPO || 'inkcraft'
const isPrivate = process.env.GITHUB_REPO_PRIVATE !== '0'

// ---- 读取 token ----
const env = {}
for (const line of readFileSync(join(ROOT, 'secrets.env.local'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const token = env.GITHUB_TOKEN
if (!token || token.length < 10) {
  console.error('未找到 GITHUB_TOKEN。请编辑 secrets.env.local 加一行：GITHUB_TOKEN=你的令牌')
  console.error('创建令牌（经典、repo 权限）：https://github.com/settings/tokens/new?scopes=repo&description=inkcraft-upload')
  process.exit(1)
}

const gh = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {})
    }
  })
  return res
}

const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf-8' }).trim()

// ---- 1. 验证 token & 获取用户名 ----
const userRes = await gh('/user')
if (!userRes.ok) {
  console.error(`token 无效（HTTP ${userRes.status}）：${(await userRes.text()).slice(0, 150)}`)
  process.exit(1)
}
const user = (await userRes.json()).login
console.log(`[push] 认证 OK：@${user}`)

// ---- 2. 创建仓库（已存在则复用）----
const createRes = await gh('/user/repos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: repoName,
    private: isPrivate,
    description: '墨匠 InkCraft —— Windows 端 AI 长篇小说创作软件（RAG 长篇记忆 / 去AI味 / 创世向导）',
    has_wiki: false,
    has_projects: false
  })
})
if (createRes.status === 201) {
  console.log(`[push] 已创建仓库：${user}/${repoName}（${isPrivate ? '私有' : '公开'}）`)
} else if (createRes.status === 422) {
  console.log(`[push] 仓库已存在，直接复用：${user}/${repoName}`)
} else {
  console.error(`创建仓库失败 HTTP ${createRes.status}：${(await createRes.text()).slice(0, 200)}`)
  process.exit(1)
}

// ---- 3. 配置远程（token 仅用于本次推送，之后还原为干净 URL）----
try {
  git('remote remove origin')
} catch {
  /* 不存在则忽略 */
}
git(`remote add origin https://${token}@github.com/${user}/${repoName}.git`)

// ---- 4. 推送 main（含全部提交历史）----
console.log('[push] 推送 main（全部历史）…')
try {
  const out = execSync('git push -u origin main', { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  console.log(out.trim())
} catch (err) {
  console.error(`推送失败：${err.stderr?.toString().slice(0, 300) ?? err.message}`)
  git('remote set-url origin https://github.com/' + user + '/' + repoName + '.git')
  process.exit(1)
}

// ---- 5. 清理：远程 URL 去掉 token ----
git(`remote set-url origin https://github.com/${user}/${repoName}.git`)

// ---- 6. 验证 ----
const head = git('rev-parse HEAD')
const remoteHeads = git('ls-remote origin main')
if (remoteHeads.includes(head)) {
  console.log(`\n[push] ===== 完成 =====`)
  console.log(`仓库地址：https://github.com/${user}/${repoName}`)
  console.log(`本地 HEAD ${head.slice(0, 8)} 已在远端，提交历史完整保留。`)
} else {
  console.error('远端校验失败，请手动检查')
  process.exit(1)
}
