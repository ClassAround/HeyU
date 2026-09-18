/** 앱 전역에서 공유하는 타입. main / preload / renderer 모두가 import 한다. */

/** 더빙 파이프라인의 단계. UI 진행 표시와 1:1 대응한다. */
export type JobStage =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'submitting'
  | 'translating'
  | 'downloading'
  | 'done'
  | 'failed'
  | 'canceled'

export interface JobProgress {
  jobId: string
  stage: JobStage
  /** 0~1. 단계별 세부 진행률을 알 수 없으면 null. */
  ratio: number | null
  message: string
  /** stage === 'done' 일 때만 채워진다. 로컬 절대 경로. */
  outputPath?: string
  /** stage === 'failed' 일 때만 채워진다. */
  error?: string
}

export interface GoogleProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

/** 어떤 자격증명이 저장되어 있는지 — 값 자체는 절대 렌더러로 보내지 않는다. */
export interface CredentialStatus {
  heygen: boolean
  openai: boolean
  google: boolean
}

export interface DubOptions {
  /** 'precision' 은 립싱크 품질이 높고 느리다. 'speed' 는 반대. */
  mode: 'speed' | 'precision'
  /** 원본 화자 목소리를 복제하지 않고 HeyGen 프리셋 음성을 쓸지. */
  useStockVoice: boolean
  /** 배경 음악 트랙 제거 여부. */
  removeMusic: boolean
}

export interface SelectedVideo {
  path: string
  name: string
  sizeBytes: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 어시스턴트가 도구를 호출했을 때 UI에 표시할 요약. */
  toolNote?: string
}

/** 2분 미만 요구사항의 기준값(초). */
export const MAX_DURATION_SECONDS = 120
