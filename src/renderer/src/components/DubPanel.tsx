import { useEffect, useRef, useState } from 'react'
import {
  MAX_DURATION_SECONDS,
  type DubOptions,
  type JobProgress,
  type SelectedVideo
} from '../../../shared/types'

interface Props {
  video: SelectedVideo | null
  setVideo: (v: SelectedVideo | null) => void
  job: JobProgress | null
  hasHeygen: boolean
  onOpenSettings: () => void
}

/** 로컬 파일을 렌더러에서 재생하기 위한 전용 URL. file:// 직접 노출을 피한다. */
const mediaUrl = (path: string): string => `heyu-media://local/${encodeURIComponent(path)}`

const STEPS: Array<[JobProgress['stage'], string]> = [
  ['uploading', '업로드'],
  ['submitting', '요청'],
  ['translating', '더빙 생성'],
  ['downloading', '내려받기'],
  ['done', '완료']
]

function fmtSize(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)}GB`
    : `${(bytes / 1024 ** 2).toFixed(1)}MB`
}

function fmtDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function DubPanel({
  video,
  setVideo,
  job,
  hasHeygen,
  onOpenSettings
}: Props): JSX.Element {
  const [over, setOver] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [opts, setOpts] = useState<DubOptions>({
    mode: 'precision',
    useStockVoice: false,
    removeMusic: false
  })
  const previewRef = useRef<HTMLVideoElement>(null)

  // 영상이 바뀌면 길이 정보를 버린다. 이전 영상 값이 남아 잘못된 경고가 뜨는 걸 막는다.
  useEffect(() => setDuration(null), [video?.path])

  const running =
    job != null && !['idle', 'done', 'failed', 'canceled'].includes(job.stage)

  const pick = async (): Promise<void> => {
    const v = await window.heyu.video.pick()
    if (v) setVideo(v)
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = window.heyu.video.pathForFile(file)
    if (path) setVideo(await window.heyu.video.setPath(path))
  }

  const start = async (): Promise<void> => {
    await window.heyu.job.start(opts)
  }

  const tooLong = duration != null && duration > MAX_DURATION_SECONDS

  return (
    <div className="pane">
      <div className="label">원본 영상</div>

      {!video ? (
        <div
          className={`drop${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => void onDrop(e)}
        >
          <h2>영상을 여기에 끌어다 놓으세요</h2>
          <p>MP4 · MOV · WebM · MKV · AVI — 2분 미만 권장</p>
          <button className="btn" onClick={() => void pick()}>
            파일 선택
          </button>
        </div>
      ) : (
        <div className="videocard">
          <div className="row">
            <div style={{ minWidth: 0 }}>
              <div className="name">{video.name}</div>
              <div className="meta">
                {fmtSize(video.sizeBytes)}
                {duration != null && ` · ${fmtDuration(duration)}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {tooLong && <span className="badge warn">2분 초과</span>}
              {!running && (
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    void window.heyu.video.clear()
                    setVideo(null)
                  }}
                >
                  변경
                </button>
              )}
            </div>
          </div>

          <video
            ref={previewRef}
            className="preview"
            src={mediaUrl(video.path)}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />

          {tooLong && (
            <div className="note" style={{ marginTop: 12 }}>
              길이가 {fmtDuration(duration!)}입니다. 더빙은 분당 크레딧이 과금되므로 길수록 비용이
              늘어납니다. 그대로 진행할 수는 있습니다.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 24 }} className="label">
        더빙 옵션 · 한국어 → 영어
      </div>

      <div className="opts">
        <label className={`opt${opts.mode === 'precision' ? ' on' : ''}`}>
          <input
            type="radio"
            checked={opts.mode === 'precision'}
            onChange={() => setOpts({ ...opts, mode: 'precision' })}
            disabled={running}
          />
          <div>
            <div className="t">정밀 (precision)</div>
            <div className="d">립싱크 품질이 높습니다. 생성 시간이 더 걸립니다.</div>
          </div>
        </label>

        <label className={`opt${opts.mode === 'speed' ? ' on' : ''}`}>
          <input
            type="radio"
            checked={opts.mode === 'speed'}
            onChange={() => setOpts({ ...opts, mode: 'speed' })}
            disabled={running}
          />
          <div>
            <div className="t">빠름 (speed)</div>
            <div className="d">결과를 빨리 받습니다. 립싱크 정밀도는 낮아집니다.</div>
          </div>
        </label>

        <label className={`opt${opts.useStockVoice ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={opts.useStockVoice}
            onChange={(e) => setOpts({ ...opts, useStockVoice: e.target.checked })}
            disabled={running}
          />
          <div>
            <div className="t">프리셋 음성 사용</div>
            <div className="d">
              끄면 원본 화자의 목소리를 복제합니다. 켜면 원어민 발음이 더 자연스럽지만 목소리가
              달라집니다.
            </div>
          </div>
        </label>

        <label className={`opt${opts.removeMusic ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={opts.removeMusic}
            onChange={(e) => setOpts({ ...opts, removeMusic: e.target.checked })}
            disabled={running}
          />
          <div>
            <div className="t">배경 음악 제거</div>
            <div className="d">말소리만 남깁니다.</div>
          </div>
        </label>
      </div>

      {!hasHeygen ? (
        <button className="btn primary" onClick={onOpenSettings}>
          HeyGen API 키 설정하기
        </button>
      ) : running ? (
        <button className="btn" onClick={() => void window.heyu.job.cancel()}>
          작업 취소
        </button>
      ) : (
        <button className="btn primary" onClick={() => void start()} disabled={!video}>
          영어로 더빙하기
        </button>
      )}

      {job && job.stage !== 'idle' && (
        <div className="progress">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong style={{ fontSize: 13.5 }}>{job.message}</strong>
            {job.ratio != null && (
              <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                {Math.round(job.ratio * 100)}%
              </span>
            )}
          </div>

          {running && (
            <div className={`bar${job.ratio == null ? ' indet' : ''}`}>
              <i style={job.ratio != null ? { width: `${job.ratio * 100}%` } : undefined} />
            </div>
          )}

          <div className="steps">
            {STEPS.map(([stage, name], i) => {
              const order = STEPS.findIndex(([s]) => s === job.stage)
              const cls = order === i ? 'active' : order > i ? 'past' : ''
              return (
                <span key={stage} className={cls}>
                  {name}
                  {i < STEPS.length - 1 && <span style={{ margin: '0 4px' }}>→</span>}
                </span>
              )
            })}
          </div>

          {job.stage === 'failed' && (
            <div className="note" style={{ marginTop: 13, color: '#e8a29a', borderColor: 'rgba(224,90,78,.3)', background: 'rgba(224,90,78,.1)' }}>
              {job.error}
            </div>
          )}

          {job.stage === 'done' && job.outputPath && (
            <>
              <video className="preview" src={mediaUrl(job.outputPath)} controls />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="btn sm"
                  onClick={() => void window.heyu.shell.reveal(job.outputPath!)}
                >
                  폴더에서 보기
                </button>
                <span
                  style={{
                    color: 'var(--text-faint)',
                    fontSize: 12,
                    fontFamily: 'var(--mono)',
                    alignSelf: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {job.outputPath}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
