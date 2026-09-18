import type { HeyuApi } from '../../preload/index'

declare global {
  interface Window {
    heyu: HeyuApi
  }
}

export {}
