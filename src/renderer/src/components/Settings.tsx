import { useEffect, useState } from 'react'
import type { CredentialStatus, McpStatus } from '../../../shared/types'

interface Props {
  onClose: () => void
  onSaved: () => void
  status: CredentialStatus
}

/**
 * 자격증명 설정.
 * 저장된 키 값은 절대 되읽지 않는다 — 렌더러는 "설정됨" 여부만 안다.
 * 그래서 입력란은 항상 비어 있고, 비워둔 채 저장하면 기존 값을 유지한다.
 */
export default function Settings({ onClose, onSaved, status }: Props): JSX.Element {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mcp, setMcp] = useState<McpStatus>({ connected: false })
  /** 연결 버튼은 브라우저를 띄우고 사람이 로그인할 때까지 몇 분이고 기다린다. */
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpNote, setMcpNote] = useState<string | null>(null)
  useEffect(() => {
    void window.heyu.auth.allowedDomains().then((d) => setDomains(d.join(', ')))
    void window.heyu.mcp.status().then(setMcp)
  }, [])

  const connectMcp = async (): Promise<void> => {
    setMcpBusy(true)
    setMcpNote('브라우저에서 HeyGen 로그인을 완료해 주세요…')
    try {
      const res = await window.heyu.mcp.connect()
      if (!res.ok) {
        setMcpNote(res.error ?? 'HeyGen 연결에 실패했습니다.')
        return
      }
      setMcp(res.status!)
      // 연결 자체보다 "무엇을 쓸 수 있게 되었는지"가 사용자에게 의미 있는 정보다.
      const tools = await window.heyu.mcp.tools()
      setMcpNote(tools.ok ? `연결됨 · 도구 ${tools.count}개 사용 가능` : '연결됨')
      onSaved()
    } finally {
      setMcpBusy(false)
    }
  }

  const disconnectMcp = async (): Promise<void> => {
    setMcpBusy(true)
    try {
      const res = await window.heyu.mcp.disconnect()
      setMcp(res.status)
      setMcpNote(null)
      onSaved()
    } finally {
      setMcpBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (clientId.trim()) await window.heyu.creds.setGoogleClient(clientId, clientSecret)

      await window.heyu.auth.setAllowedDomains(
        domains.split(',').map((d) => d.trim()).filter(Boolean)
      )

      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const mark = (on: boolean): JSX.Element =>
    on ? <span className="badge ok">설정됨</span> : <span className="badge warn">미설정</span>

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>설정</h3>
        <p className="sub">
          연결 순서: ① Google 로그인 → ② HeyGen 계정 연결. 키와 토큰은 OS 보안
          저장소(macOS 키체인 / Windows DPAPI)로 암호화되어 이 PC에만 저장됩니다.
        </p>

        <div className="group">
          <div className="label">
            HeyGen 계정 연결 {mark(mcp.connected)}
          </div>
          {mcp.connected && mcp.account && (
            <div className="hint" style={{ marginBottom: 8 }}>
              연결된 계정: <b>{mcp.account}</b>
            </div>
          )}
          <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
            {mcp.connected ? (
              <button className="btn ghost" onClick={() => void disconnectMcp()} disabled={mcpBusy}>
                {mcpBusy ? '처리 중…' : '연결 해제'}
              </button>
            ) : (
              <button className="btn primary" onClick={() => void connectMcp()} disabled={mcpBusy}>
                {mcpBusy ? '브라우저에서 로그인 대기 중…' : 'HeyGen 계정 연결'}
              </button>
            )}
          </div>
          {mcpNote && <div className="hint" style={{ marginBottom: 6 }}>{mcpNote}</div>}
          <div className="hint">
            브라우저 로그인으로 HeyGen MCP에 연결합니다. <b>API 키는 필요하지 않습니다.</b>
            연결 후 영상을 선택하고 더빙 버튼을 누르면 됩니다.
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            더빙은 이 MCP 연결로 실행됩니다. 이용 요금은 HeyGen 웹 플랜의 크레딧 정책을 따릅니다.
          </div>
        </div>

        <div className="group">
          <div className="label">
            Google 로그인 {mark(status.google)}
          </div>
          <input
            className="field"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="클라이언트 ID (....apps.googleusercontent.com)"
            style={{ marginBottom: 8 }}
          />
          <input
            className="field"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="클라이언트 보안 비밀 (선택)"
          />
          <div className="hint">
            Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID → 유형을{' '}
            <b>데스크톱 앱</b>으로 생성하세요. 웹 애플리케이션 유형은 동작하지 않습니다.
          </div>
        </div>

        <div className="group">
          <div className="label">허용 도메인</div>
          <input
            className="field"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="titanz.co.kr, titan.kr (비우면 제한 없음)"
          />
          <div className="hint" style={{ marginBottom: 10 }}>
            쉼표로 구분합니다. 로그인 시 Google이 서명한 ID 토큰의 <code>hd</code> 클레임으로
            확인하므로 이메일 문자열 위조로는 통과할 수 없습니다.
          </div>
          <div className="note">
            이 검사는 사용자 PC에서 실행됩니다. 앱을 수정하면 우회할 수 있으므로 <b>보안 경계가
            아니라 접근 안내</b>로 보세요. 실제 차단이 필요하면 서버에서 검증해야 합니다.
          </div>
        </div>

        {error && (
          <div className="group">
            <div className="note" style={{ color: '#e8a29a', borderColor: 'rgba(224,90,78,.3)', background: 'rgba(224,90,78,.1)' }}>
              {error}
            </div>
          </div>
        )}

        <div className="actions">
          <button
            className="btn ghost"
            onClick={() => void window.heyu.onboarding.reset().then(onSaved).then(onClose)}
            disabled={busy}
            style={{ marginRight: 'auto' }}
          >
            연결 안내 다시 보기
          </button>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? '확인 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
