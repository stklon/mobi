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
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
