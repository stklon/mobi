# 开发指南（DEVELOPMENT）

> 墨匠 InkCraft 开发环境与常用命令。产品设计文档见 [docs/](docs/README.md)。

## 环境

| 工具 | 位置/版本 | 说明 |
|---|---|---|
| Node.js | `C:\devtools\node`（v24.22.1 LTS 便携版） | 已加入当前用户 PATH；新终端若不可用请检查 PATH |
| pnpm | 12.15.0（`C:\devtools\node\pnpm.cmd`） | 随 Node 全局安装 |
| Electron | 43.8.3（ABI 148） | 二进制已下载并缓存 |
| better-sqlite3 | 13.0.3（**N-API**） | 预编译随 npm 包发布，Node/Electron 通用，**无需 electron-rebuild** |

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

- [x] M1-W1~W2：monorepo 骨架、书架/项目 CRUD、卷/章节 CRUD、编辑器（textarea + 1s 防抖自动保存 + 字数统计）、SQLite 迁移框架、typed IPC、冒烟测试
- [ ] M1-W3~W4：TipTap 富文本编辑器（划词菜单/草稿态标记）、设置页（模型 Provider 配置 + Key 加密存储 + 连通性测试）、版本快照
- [ ] M2：AIOrchestrator、PromptEngine、流式续写
- [ ] M3：创世向导、Codex、三层大纲
- [ ] M4：RAG 管线、记忆系统、导出
- [ ] M5：压测与打包

## 已知技术决策备忘

1. **better-sqlite3 v13（N-API）**：不再需要为 Electron 重编译原生模块；代价是锁死大版本（v12 及以下为旧 ABI 机制）。
2. **单库文件**：V1 实现为单 `library.db`（projects/volumes/chapters 表带 project_id），较开发文档的"单书单库"简化；SQLite 处理百万字无压力，如后续需要再拆分。
3. **pnpm 12**：构建脚本白名单（`onlyBuiltDependencies`）已迁至 `pnpm-workspace.yaml`。
4. **electron-vite 6 + Vite 8（rolldown）**：main/preload 输出 CJS 到 `out/`，`main` 字段指向 `out/main/index.js`。
