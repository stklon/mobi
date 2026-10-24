/// <reference types="vite/client" />
import type { InkcraftApi } from '@inkcraft/shared'

declare global {
  interface Window {
    inkcraft: InkcraftApi
  }
}

export {}
