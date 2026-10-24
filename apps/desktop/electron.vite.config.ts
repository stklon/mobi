import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    // 打包友好：仅原生模块 better-sqlite3 保持外部依赖（运行时从 app 的
    // node_modules 加载），其余（@inkcraft/*、docx）全部 bundle 进产物，
    // 规避 pnpm workspace 符号链接在 electron-builder 下的解析问题。
    build: {
      rollupOptions: {
        external: ['better-sqlite3'],
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      // workspace 包解析到 TS 源码（ESM），而非 node_modules 里的 dist（CJS）：
      // dist 由 tsc 编为 __exportStar 的 CommonJS，Vite dev 冷缓存竞态下会把该
      // 文件按原生 ESM 直接发给浏览器，命名导出（GENRES/CODEX_TYPES 等）全部
      // 丢失 → SyntaxError 白屏。源码是 ESM 且免去渲染层改动前的 build:packages
      // 等待。主进程/preload 经 esbuild bundle，CJS 无此问题，保持 node 解析。
      alias: [
        { find: /^@inkcraft\/core$/, replacement: resolve(__dirname, '../../packages/core/src/index.ts') },
        { find: /^@inkcraft\/shared$/, replacement: resolve(__dirname, '../../packages/shared/src/index.ts') }
      ]
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
