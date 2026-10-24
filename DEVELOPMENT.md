# 开发指南（DEVELOPMENT）

> 墨匠 InkCraft 开发环境与常用命令。产品设计文档见 [docs/](docs/README.md)。

## 环境

| 工具 | 位置/版本 | 说明 |
|---|---|---|
| Node.js | `C:\devtools\node`（v24.22.1 LTS 便携版） | 已加入当前用户 PATH；新终端若不可用请检查 PATH |
| pnpm | 12.15.0（`C:\devtools\node\pnpm.cmd`） | 随 Node 全局安装 |
| Git | `C:\devtools\git`（2.56 便携版） | 已加入用户 PATH；仓库身份为 repo 级配置（inkcraft-dev），可自行修改 |
| Electron | 43.8.3（ABI 148） | 二进制已下载并缓存 |
| better-sqlite3 | 13.0.3（**N-API**） | 预编译随 npm 包发布，Node/Electron 通用，**无需 electron-rebuild** |
| TipTap | 3.32.0 | 章节编辑器（纯文本段落模型，禁用格式化扩展） |

## 常用命令（均在仓库根目录执行）

```bash
pnpm install        # 安装依赖（详见下方网络注意事项）
pnpm dev            # 开发模式（热更新，自动打开 DevTools）
pnpm build          # 构建全部（shared/core 编译 + desktop 打包到 out/）
pnpm typecheck      # 全部包 TypeScript 类型检查
pnpm smoke          # 冒烟测试：构建后启动应用，无头验证服务层全链路并自动退出
pnpm start          # 运行已构建的应用（不重新构建）
```

## 网络注意事项（国内环境）

Electron 二进制从 GitHub Releases 下载，直连可能被重置。如 `pnpm install` 后
`node_modules/.pnpm/electron@*/node_modules/electron/dist/electron.exe` 不存在，执行：

```bash
cd node_modules/.pnpm/electron@43.8.3/node_modules/electron
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
node install.js
```

## 目录结构

```
├─ apps/desktop/            # Electron 应用
│  ├─ src/main/             # 主进程：窗口、IPC、服务层、SQLite
│  │  ├─ db/                #   database.ts + migrations.ts（顺序迁移）
│  │  ├─ services/          #   libraryService.ts（项目/卷/章节持久化）
│  │  └─ ipc.ts             #   IPC 通道注册（契约在 packages/shared）
│  ├─ src/preload/          # contextBridge 暴露 window.inkcraft
│  ├─ src/renderer/         # React UI（书架 Bookshelf / 工作台 Workbench）
│  └─ electron.vite.config.ts
├─ packages/shared/         # 渲染/主进程共享：DTO 类型 + IPC 契约（单一事实来源）
├─ packages/core/           # 纯 TS 领域逻辑：zod 校验 schema、中文字数统计
├─ docs/                    # PRD / SRS / 开发设计 / 提示词模板库
└─ scripts/                 # 环境搭建脚本
```

## 数据位置

开发模式数据存于 `%APPDATA%\@inkcraft\desktop\data\library.db`（SQLite，WAL 模式）。
如需重置本地数据：关闭应用后删除该目录即可。

## 当前进度（对照开发文档里程碑）

- [x] M1：monorepo 骨架、书架/项目 CRUD、卷/章节 CRUD、TipTap 编辑器 + 自动保存、设置页（Provider + Key 加密 + 模型分工）、Git 仓库
- [x] M2：AIOrchestrator（SSE 流式/队列/取消/重试/日志）、PromptEngine、Ctrl+Enter 流式续写（草稿态高亮 + 采纳/回滚）、划词工具、快照系统
- [x] M3：创世向导四步流程、设定集 Codex（别名/常驻标记）、三层大纲 + 批量章纲、T-06 注入世界观/角色卡/章纲
- [x] M4：RAG 管线（切片/实体标注/嵌入/混合检索）、记忆系统（章后摘要）、导出 txt/docx
- [x] M5：**百万字压测全达标**（见下）、**NSIS 安装包 + 便携版打包**（产物冒烟通过）、首启引导
- [ ] 后续（V1.1+）：提示词透明度面板、模板中心编辑 UI、用量统计、卷摘要、伏笔登记表、一致性检查、epub 导出、检索评测集、代码签名与自动更新

## M5 压测结果（`pnpm --filter @inkcraft/desktop bench`）

合成书：500 章 / 60.7 万字 / 50 份摘要 / 1510 切片（走真实服务代码路径）：

| 指标 | 结果 | SRS 目标 |
|---|---|---|
| 建库 + 50 次归档索引 | 146ms | — |
| 全量索引重建（500 章 + 设定） | 205ms | 10万字 < 60s |
| RAG 检索（热缓存） | avg 0.5ms / p95 1.3ms | < 500ms |
| RAG 检索（冷启动含载入） | 2ms | — |
| T-06 全量组装（含检索） | 1.3ms | < 200ms（不含检索） |
| 章节列表（500 章）/ 单章读取 | 0.4ms / 0.0ms | — |
| 数据库体积 | 5.3 MB | ≤ 200MB/百万字 |

## 打包发布（`apps/desktop/electron-builder.yml`）

```bash
# 环境变量（国内网络必须）：electron-builder 二进制走 npmmirror
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

pnpm --filter @inkcraft/desktop dist:dir   # 免安装目录版（release/win-unpacked/，用于验证）
pnpm --filter @inkcraft/desktop dist       # NSIS 安装包 + 便携版（release/*.exe）
pnpm --filter @inkcraft/desktop bench      # 压测
pnpm smoke                                 # 全链路冒烟（也可用于验证打包产物：设 INKCRAFT_SMOKE=1 后运行 exe）
```

产物（0.1.0）：`InkCraft-Setup-0.1.0.exe`（112MB，NSIS 向导式安装）、`InkCraft-Portable-0.1.0.exe`（100MB，免安装）。默认图标、未签名（正式发布需自备图标与代码签名证书）。

打包要点：
1. **主进程已 bundle**（仅 better-sqlite3 / docx 外部化），规避 pnpm workspace 符号链接问题；
2. **npmRebuild: false**——better-sqlite3 v13 为 N-API，预编译 .node 随包分发，无需 @electron/rebuild；
3. **nodeLinker: hoisted**（pnpm 12 该配置在 pnpm-workspace.yaml，.npmrc 里的不生效）；
4. **electron 版本必须精确**（去掉 ^），否则 electron-builder 拒绝构建；
5. electronLanguages 仅保留 zh-CN/en-US，省 44MB；
6. 渲染层依赖（react/@tiptap）放 devDependencies（vite 已 bundle，运行时不需要）。

## 已知问题

- pnpm 重装（hoisted 布局变更等）后 Electron 二进制可能丢失（副作用缓存重放问题）：`cd node_modules\electron && set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && node install.js` 可恢复。

## M4 续写上下文注入（T-06 实际发送的区块）

```
铁律 → 世界观核心设定（Codex pinned，≤3000字）
     → 出场角色档案（章纲 characters 名称/别名匹配，≤4张）
     → 本章大纲（目标/情节点/出场角色/章末钩子）
     → 前文记忆（近3章：有摘要用摘要[≤400字/章]，无摘要退回原文尾巴[600字/章]）
     → 补充资料（RAG top4 ≤1500字：混合得分 = 0.6*向量 + 0.4*实体命中，
        摘要块+0.05，近15章+0.1，远章正文 0.6^(Δ/50) 衰减；跳过最近3章防重复）
     → 正文尾部（2000字）→ 续写指令
```

## RAG 数据流

```
归档章节（保存摘要）→ 正文场景切片(400~800字/块，句级重叠≤100字) + 摘要切片 → 嵌入(可选) → chunks 表
Codex 条目增删改 → 条目切片 → chunks 表（pinned 条目不入 RAG，走常驻区块）
续写 → 查询实体（章纲角色 + 正文尾部命中实体）+ 语义向量 → 混合检索 → 补充资料区块
未配置「嵌入」场景 → 自动降级为纯实体检索，功能不中断
```

## 已知技术决策备忘

1. **better-sqlite3 v13（N-API）**：不再需要为 Electron 重编译原生模块；代价是锁死大版本（v12 及以下为旧 ABI 机制）。
2. **单库文件**：V1 实现为单 `library.db`，较开发文档的"单书单库"简化；SQLite 处理百万字无压力，如后续需要再拆分。
3. **pnpm 12**：构建脚本白名单（`onlyBuiltDependencies`）已迁至 `pnpm-workspace.yaml`；`pnpm typecheck` 会先构建 shared/core（desktop 依赖其 dist 类型）；传递依赖必须显式声明（如 @tiptap/core、core→shared）。
4. **electron-vite 6 + Vite 8（rolldown）**：main/preload 输出 CJS 到 `out/`，`main` 字段指向 `out/main/index.js`。
5. **API Key 安全**：经 Electron `safeStorage`（Windows DPAPI）加密后存入 settings 表；渲染层只拿到 `hasKey` 布尔值，解密仅在主进程（`SettingService.getApiKey`）。
6. **TipTap 纯文本模型**：章节存储始终是纯文本（`\n` = 段落分隔），StarterKit 关闭全部格式化扩展；aiDraft 草稿高亮是会话级 mark，不入库。
7. **Git 身份**：repo 级占位身份 `inkcraft-dev <dev@inkcraft.local>`，提交前请改为自己的 `git config user.name/user.email`。
8. **AI 重试语义**：只有「拿到响应体之前」的失败（连接/429/5xx）才重试；流一旦开始，中断即最终失败（已收内容保留在编辑器，靠快照回滚），避免重试导致渲染层内容重复。
9. **token 用量为估算值**：SSE 不强依赖 usage 字段（兼容各家），prompt/completion 按中文 ~1.5 字/token 折算。
10. **console-message 的 level 是数字**：Electron 43 类型定义中 3 = error（不是字符串 'error'）。
11. **模板 seed 为 upsert**：每次启动把内置模板（T-01/02/03/05/06/07）同步为最新内容；做模板编辑 UI 时需引入 user_modified 标记，仅更新未被用户修改的行。
12. **章纲与章节松耦合**：outline_nodes(chapter) 按 project+chapter_no 定位，不要求正文章节先存在（可先纲后文）；续写时按当前章号自动关联。
13. **角色匹配走名称/别名**：章纲 characters 是名字数组（非 id），T-06 构建时与 Codex 角色条目的 name/aliases 精确匹配——写章纲时角色名需与设定集一致（别名也可）。
14. **向量检索用 JS 暴力余弦而非 sqlite-vec**：向量以 Float32 BLOB 存 chunks 表，全量扫描——10 万字 ≈ 200 chunk 时 <10ms，50 万字也完全够用；避免引入 sqlite-vec 原生扩展（其 GitHub 分发渠道在本网络不可达）。量级到数万 chunk 再换专用索引。
15. **关键词通道用实体标注而非 FTS5**：中文角色名多为 2 字，FTS5 trigram 需 ≥3 字无法命中；建索引时对每个 chunk 做 Codex 名称/别名标注（entities 列），检索时取查询实体与 chunk 实体的交集——效果等价、可单测、零扩展依赖。
16. **嵌入可降级**：「嵌入（RAG 检索）」场景未配置或调用失败时，RAG 自动降级为纯实体检索，功能不中断（UI 显示"N 个切片 · 未配置嵌入模型：仅实体检索"）。
17. **T-09 摘要输出为纯文本**（非模板库设计的 JSON）：摘要要给作者审阅编辑，JSON 不适合人肉编辑；key_facts/state_changes 等结构化提取留到 V1.x 角色状态快照一起做。
