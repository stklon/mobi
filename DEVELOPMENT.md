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
- [x] M3：创世向导四步流程（创意→世界观→角色→总纲，T-01/02/03 流式生成 + 可编辑）、设定集 Codex（七类条目/别名/常驻标记）、三层大纲（总纲/卷纲/章纲 + T-05 批量章纲 JSON 解析确认流）、**T-06 续写注入世界观常驻卡 + 出场角色档案（别名匹配）+ 本章大纲**
- [ ] M3 收尾（可选）：章纲一键生成正文章节、卷纲 AI 生成（T-04）、模板中心编辑 UI
- [ ] M4：RAG 管线（切片/嵌入/混合检索/Token 预算装配）、记忆系统（章后摘要/角色状态/伏笔）、导出 txt/docx
- [ ] M5：压测与打包

## M3 续写上下文注入（T-06 实际发送的区块）

```
铁律 → 世界观核心设定（Codex importance=pinned，总长≤3000字）
     → 出场角色档案（章纲 characters 按名称/别名匹配 Codex 角色，≤4张）
     → 本章大纲（目标/情节点/出场角色/章末钩子）
     → 前文衔接（前2章结尾）→ 正文尾部（2000字）→ 续写指令
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
