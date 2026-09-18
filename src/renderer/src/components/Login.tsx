import { useEffect, useState } from 'react'
import type { GoogleProfile } from '../../../shared/types'

interface Props {
  onSignedIn: (p: GoogleProfile) => void
}

/**
 * 로그인 관문. 통과하기 전에는 본 화면이 뜨지 않는다.
 *
 * 클라이언트 ID 가 빌드에 심겨 있지 않으면(개발 중) 여기서 바로 입력받는다.
 * 그러지 않으면 설정 화면이 로그인 뒤에 있어서 영원히 로그인할 수 없다.
 */
export default function Login({ onSignedIn }: Props): JSX.Element {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [domains, setDomains] = useState<string[]>([])
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.heyu.auth.config().then((c) => {
      setNeedsSetup(!c.clientIdConfigured)
      setDomains(c.allowedDomains)
      setReady(true)
    })
  }, [])

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // 설정이 필요한 상태면 입력값을 먼저 저장하고 로그인으로 넘어간다.
      if (needsSetup) {
        if (!clientId.trim()) {
          setError('클라이언트 ID를 입력해 주세요.')
          return
        }
        await window.heyu.creds.setGoogleClient(clientId, clientSecret)
      }

      const res = await window.heyu.auth.signIn()
      if (res.ok && res.profile) {
        onSignedIn(res.profile)
      } else {
        setError(res.error ?? '로그인에 실패했습니다.')
        // 저장한 클라이언트 ID 가 틀렸을 수도 있으니 입력칸을 다시 연다.
        const c = await window.heyu.auth.config()
        setNeedsSetup(!c.clientIdConfigured)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return <div className="gate" />

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <span className="dot" />
          HeyU
        </div>
        <h1>영어 립싱크 더빙</h1>
        <p className="gate-sub">
          영상을 넣으면 원본 화자의 목소리를 유지한 채 영어로 더빙해 돌려줍니다.
          <br />
          계속하려면 Google 계정으로 로그인하세요.
        </p>

        {needsSetup && (
          <div className="gate-setup">
            <div className="label">Google OAuth 클라이언트</div>
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
              Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID →
              애플리케이션 유형을 <b>데스크톱 앱</b>으로 만드세요. 한 번만 입력하면 됩니다.
            </div>
          </div>
        )}

        {error && <div className="gate-error">{error}</div>}

        <button className="btn primary gate-btn" onClick={() => void signIn()} disabled={busy}>
          {busy ? '로그인 중…' : 'Google로 로그인'}
        </button>

        {domains.length > 0 && (
          <p className="gate-note">
            {domains.map((d) => '@' + d).join(', ')} 계정만 사용할 수 있습니다.
          </p>
        )}
      </div>
    </div>
  )
}
