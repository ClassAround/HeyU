import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { CredentialStatus, GoogleProfile } from '../shared/types.js'

/**
 * 자격증명 저장소.
 *
 * API 키는 Electron safeStorage 로 암호화해서 디스크에 둔다.
 * macOS 는 Keychain, Windows 는 DPAPI 가 뒤를 받친다 — 평문 파일이 남지 않는다.
 * 복호화된 값은 메인 프로세스 밖으로 나가지 않는다. 렌더러는 "있다/없다"만 본다.
 */

interface Vault {
  heygenApiKey?: string
  openaiApiKey?: string
  googleClientId?: string
  googleClientSecret?: string
  googleRefreshToken?: string
  googleProfile?: GoogleProfile
  /** 비어 있으면 도메인 제한 없음. 예: ['titanz.co.kr'] */
  allowedDomains?: string[]
}

const vaultPath = (): string => join(app.getPath('userData'), 'credentials.bin')

let cache: Vault | null = null

function load(): Vault {
  if (cache) return cache
  const p = vaultPath()
  if (!existsSync(p)) {
    cache = {}
    return cache
  }
  try {
    const raw = readFileSync(p)
    // safeStorage 를 못 쓰는 환경(예: 리눅스 키링 부재)에서는 평문 JSON 으로 폴백해 둔 상태다.
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    cache = JSON.parse(json) as Vault
  } catch {
    // 손상되었거나 다른 머신에서 복사된 파일. 지우고 새로 시작하는 편이 안전하다.
    cache = {}
  }
  return cache
}

function persist(): void {
  const p = vaultPath()
  mkdirSync(dirname(p), { recursive: true })
  const json = JSON.stringify(cache ?? {})
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  writeFileSync(p, buf, { mode: 0o600 })
}

export const store = {
  get<K extends keyof Vault>(key: K): Vault[K] {
    return load()[key]
  },

  set<K extends keyof Vault>(key: K, value: Vault[K]): void {
    load()
    cache![key] = value
    persist()
  },

  clear(key: keyof Vault): void {
    load()
    delete cache![key]
    persist()
  },

  /** 렌더러에 노출해도 되는 형태 — 키 존재 여부만. */
  status(): CredentialStatus {
    const v = load()
    return {
      heygen: Boolean(v.heygenApiKey),
      openai: Boolean(v.openaiApiKey),
      google: Boolean(v.googleRefreshToken)
    }
  }
}
