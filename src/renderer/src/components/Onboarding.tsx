import { useEffect, useState } from 'react'
import type { CredentialStatus, McpStatus } from '../../../shared/types'

interface Props {
  status: CredentialStatus
  onDone: () => void
  onChanged: () => void
}

/**
 * 최초 1회 연결 안내.
 *
 * 연결 항목을 설정 화면 안에만 두면 아무도 찾아 들어가지 않는다. 로그인 직후 한 번
 * 정면으로 물어보고, 끝나면 다시 띄우지 않는다 — 매번 뜨는 안내는 방해일 뿐이다.
 *
 * **건너뛸 수 있어야 한다.** HeyGen 연결이 없어도 앱은 켜져야 하고, 나중에 설정에서
 * 이어서 할 수 있다. 여기서 사용자를 붙잡아 두면 그냥 앱을 닫는다.
 */
export default function Onboarding({ status, onDone, onChanged }: Props): JSX.Element {
  const [mcp, setMcp] = useState<McpStatus>({ connected: false })
  const [busy, setBusy] = useState<'mcp' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setMcp(await window.heyu.mcp.status())
    onChanged()
  }

  useEffect(() => {
    void refresh()
  }, [])

  const connectMcp = async (): Promise<void> => {
    setBusy('mcp')
    setError(null)
    setNote('브라우저에서 HeyGen 로그인을 완료해 주세요…')
    try {
      const res = await window.heyu.mcp.connect()
      if (!res.ok) {
        setError(res.error ?? 'HeyGen 연결에 실패했습니다.')
        return
      }
      const tools = await window.heyu.mcp.tools()
      setNote(tools.ok ? `연결됨 · HeyGen 도구 ${tools.count}개를 쓸 수 있습니다.` : null)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  /** 완료 표시. 자리는 항상 잡아둔다 — 붙었다 떨어졌다 하면 제목이 좌우로 흔들린다. */
  const check = (on: boolean): JSX.Element => (
    <span className="ob-check" aria-label={on ? '완료' : undefined}>
      {on ? '✓' : ''}
    </span>
  )

  return (
    <div className="gate">
      <div className="gate-card ob">
        <div className="gate-brand">
          <span className="dot" />
          RAWCUT GLOBAL
        </div>
        <h1>연결 설정</h1>
        <p className="gate-sub">한 번만 하면 됩니다. 나중에 설정에서 바꿀 수 있습니다.</p>

        {/* HeyGen MCP 연결 */}
        <div className="ob-step">
          <div className="ob-head">
            <div className="ob-title">
              {check(mcp.connected)}
              HeyGen 계정
              <span className="ob-tag">더빙에 필요</span>
            </div>
            {mcp.connected ? (
              <span className="ob-value">{mcp.account ?? '연결됨'}</span>
            ) : (
              <button className="btn sm" onClick={() => void connectMcp()} disabled={busy !== null}>
                {busy === 'mcp' ? '로그인 대기 중…' : '연결'}
              </button>
            )}
          </div>
          <div className="ob-desc">
            HeyGen 계정을 연결하면 영상을 업로드하고 영어 립싱크 더빙을 실행할 수 있습니다.
            API 키 없이 앱이 HeyGen MCP를 직접 호출합니다.
          </div>
        </div>

        {note && <div className="ob-note">{note}</div>}
        {error && <div className="gate-error">{error}</div>}

        <button className="btn primary gate-btn" onClick={onDone}>
          {status.heygenMcp ? '시작하기' : '나중에 하고 시작하기'}
        </button>
      </div>
    </div>
  )
}
