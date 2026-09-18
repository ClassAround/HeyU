/**
 * HTTP Range 헤더 해석.
 *
 * 왜 따로 떼어 뒀는가 — `<video>` 재생의 성패가 여기 달려 있는데, 프로토콜 핸들러
 * 안에 묻어두면 테스트할 수가 없다. 실제로 이 처리가 없어서 영상이 2초만 재생되고
 * 멈추는 버그가 있었다(브라우저는 구간 단위로 요청하며 재생한다).
 *
 * RFC 7233 중 단일 구간만 다룬다. 멀티파트 범위(`bytes=0-99,200-299`)는
 * 미디어 재생에 쓰이지 않으므로 전체 응답으로 떨어뜨린다.
 */

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' }

export function resolveRange(size: number, header: string | null): RangeResult {
  if (!header) return { kind: 'full' }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return { kind: 'full' }

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return { kind: 'full' }

  let start: number
  let end: number

  if (rawStart === '') {
    // `bytes=-500` — 뒤에서 500바이트. MP4 의 moov 가 끝에 있는 파일에서 실제로 쓰인다.
    const suffix = Number(rawEnd)
    if (!Number.isInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    // 파일보다 큰 suffix 는 "전체"를 뜻한다. 음수 시작으로 넘어가면 안 된다.
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    if (!Number.isInteger(start)) return { kind: 'unsatisfiable' }
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
    if (!Number.isInteger(end)) return { kind: 'unsatisfiable' }
    // 끝 지점이 파일을 넘어가면 잘라준다. 명세가 요구하는 동작이다.
    end = Math.min(end, size - 1)
  }

  // 빈 파일에는 만족시킬 수 있는 범위가 없다.
  if (size === 0 || start >= size || start > end) return { kind: 'unsatisfiable' }

  return { kind: 'partial', start, end }
}
