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

- [x] M1-W1~W2：monorepo 骨架、书架/项目 CRUD、卷/章节 CRUD、编辑器 + 1s 防抖自动保存 + 字数统计、SQLite 迁移框架、typed IPC、冒烟测试
- [x] M1-W3~W4：设置页（Provider CRUD + API Key DPAPI 加密存储 + OpenAI 兼容连通性测试 + 模型分工五场景）、TipTap 富文本编辑器（撤销重做/纯文本段落模型）、Git 仓库初始化
- [ ] M2：AIOrchestrator（流式/队列/重试）、PromptEngine（模板渲染/Token 预算）、基础续写（无 RAG）、划词润色、快照回滚
- [ ] M3：创世向导、Codex、三层大纲
- [ ] M4：RAG 管线、记忆系统、导出
- [ ] M5：压测与打包

## 已知技术决策备忘

1. **better-sqlite3 v13（N-API）**：不再需要为 Electron 重编译原生模块；代价是锁死大版本（v12 及以下为旧 ABI 机制）。
2. **单库文件**：V1 实现为单 `library.db`（projects/volumes/chapters/settings 表），较开发文档的"单书单库"简化；SQLite 处理百万字无压力，如后续需要再拆分。
3. **pnpm 12**：构建脚本白名单（`onlyBuiltDependencies`）已迁至 `pnpm-workspace.yaml`；`pnpm typecheck` 会先构建 shared/core（desktop 依赖其 dist 类型）。
4. **electron-vite 6 + Vite 8（rolldown）**：main/preload 输出 CJS 到 `out/`，`main` 字段指向 `out/main/index.js`。
5. **API Key 安全**：经 Electron `safeStorage`（Windows DPAPI）加密后存入 settings 表；渲染层只拿到 `hasKey` 布尔值，解密仅在主进程（`SettingService.getApiKey`，M2 的 AI 编排器调用）。
6. **TipTap 纯文本模型**：章节存储始终是纯文本（`\n` = 段落分隔），StarterKit 关闭了全部格式化/列表/链接扩展，仅保留 document/paragraph/text/undoRedo/dropcursor——保证导出与后续 RAG 切片不依赖富文本结构。
7. **Git 身份**：repo 级占位身份 `inkcraft-dev <dev@inkcraft.local>`，提交前请改为自己的 `git config user.name/user.email`。
