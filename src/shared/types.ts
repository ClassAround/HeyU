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
  google: boolean
  /** HeyGen MCP 가 OAuth 로 연결되어 있는지. API 키와 별개다. */
  heygenMcp: boolean
}

/** HeyGen MCP 연결 상태. 토큰 값 자체는 렌더러로 가지 않는다. */
export interface McpStatus {
  connected: boolean
  /** 연결된 HeyGen 계정 표시용(이메일 등). 서버가 알려주지 않으면 비어 있다. */
  account?: string
  /** 액세스 토큰 만료 시각(epoch ms). 만료 정보가 없으면 undefined. */
  expiresAt?: number
}

/** MCP 서버가 제공하는 도구 하나. 대화 레이어가 LLM 함수 정의로 변환한다. */
export interface McpToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
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

/** 2분 미만 요구사항의 기준값(초). */
export const MAX_DURATION_SECONDS = 120

/**
 * HeyGen 직접 업로드 상한 (200 MiB).
 *
 * 문서에 없어서 실제로 부딪혀 알아낸 값이다 — 초과하면 업로드 시작 시점에
 * `File too large. Maximum is 200 MiB (209,715,200 bytes).` 를 돌려준다.
 * 멀티파트 업로드(32MB)와는 다른 값이니 헷갈리지 말 것.
 *
 * **이 값으로 작업을 막지 말 것.** 상한을 정하는 쪽은 HeyGen 이고 이건 복사본일 뿐이다.
 * 여기서 차단하면 HeyGen 이 상한을 올렸을 때 앱이 멀쩡한 파일을 거부한다.
 * 경고에만 쓰고, 거절 여부는 서버가 판단하게 둔다.
 */
export const MAX_UPLOAD_BYTES = 209_715_200
