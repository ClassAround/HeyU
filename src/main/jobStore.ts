import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { DubOptions, JobProgress } from '../shared/types.js'

/**
 * 진행 중인 작업 기록.
 *
 * 왜 필요한가 — 번역은 **HeyGen 서버에서** 돌아간다. 앱을 닫아도 작업은 계속 진행되고
 * 크레딧도 이미 빠져나간 상태다. 그런데 폴링하던 쪽이 사라지면 결과를 받을 방법이 없다.
 * 사용자 입장에서는 "돈만 쓰고 결과가 증발"한 것이다.
 *
 * 그래서 translation id 를 디스크에 적어두고 다음 실행 때 다시 붙는다.
 * 앱을 껐다 켜는 것이 작업을 취소하는 것과 같아서는 안 된다.
 *
 * credentials.bin 과 달리 암호화하지 않는다 — 비밀이 아니라 작업 메모다.
 * (translation id 자체로는 API 키 없이 아무것도 조회할 수 없다.)
 */

export interface ActiveJobRecord {
  /** Missing on legacy REST jobs. Never resubmit across billing paths. */
  transport?: 'mcp' | 'api'
  jobId: string
  translationId: string
  /** 결과 파일 이름을 만들 때 쓰는, 확장자·금지문자를 제거한 원본 이름. */
  safeName: string
  opts: DubOptions
  startedAt: number
}

interface JobFile {
  active?: ActiveJobRecord
  /** 마지막으로 끝난 작업. 앱을 다시 켰을 때 결과 카드를 그대로 보여주기 위한 것. */
  last?: JobProgress
}

const filePath = (): string => join(app.getPath('userData'), 'jobs.json')

let cache: JobFile | null = null

function load(): JobFile {
  if (cache) return cache
  const p = filePath()
  if (!existsSync(p)) {
    cache = {}
    return cache
  }
  try {
    cache = JSON.parse(readFileSync(p, 'utf8')) as JobFile
  } catch {
    // 손상된 메모 때문에 앱이 못 켜질 이유는 없다. 버리고 새로 시작한다.
    cache = {}
  }
  return cache
}

function persist(): void {
  const p = filePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(cache ?? {}, null, 2), 'utf8')
}

export const jobStore = {
  active: (): ActiveJobRecord | undefined => load().active,

  setActive(record: ActiveJobRecord): void {
    load()
    cache!.active = record
    persist()
  },

  clearActive(): void {
    load()
    delete cache!.active
    persist()
  },

  last: (): JobProgress | undefined => load().last,

  setLast(progress: JobProgress): void {
    load()
    cache!.last = progress
    delete cache!.active
    persist()
  }
}
