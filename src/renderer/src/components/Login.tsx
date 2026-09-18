import { useEffect, useState } from 'react'
import type { GoogleProfile } from '../../../shared/types'
import { GoogleMark } from './brand'

interface Props {
  onSignedIn: (p: GoogleProfile) => void
}

/**
 * 로그인 관문. 통과하기 전에는 본 화면이 뜨지 않는다.
 *
 * 화면에는 **버튼 하나만** 둔다. OAuth 클라이언트 ID 는 비밀이 아니고 팀 전체가 같은 값을
 * 쓰므로 사람마다 붙여넣게 할 이유가 없다 — `.env` 나 빌드 환경변수로 심는다.
 *
 * 다만 심어두지 않은 상태에서 입력할 곳이 아예 없으면 **영원히 로그인할 수 없다**
 * (설정 화면이 로그인 뒤에 있기 때문이다). 그래서 입력칸은 지우지 않고,
 * 실제로 필요해졌을 때 — 버튼을 눌렀는데 ID 가 없을 때 — 만 펼친다.
 */
export default function Login({ onSignedIn }: Props): JSX.Element {
  const [ready, setReady] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [domains, setDomains] = useState<string[]>([])
  const [showSetup, setShowSetup] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.heyu.auth.config().then((c) => {
      setConfigured(c.clientIdConfigured)
      setDomains(c.allowedDomains)
      setReady(true)
    })
  }, [])

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // 입력칸을 펼쳐둔 상태라면 그 값을 먼저 저장한다.
      if (showSetup) {
        if (!clientId.trim()) {
          setError('클라이언트 ID를 입력해 주세요.')
          return
        }
        await window.heyu.creds.setGoogleClient(clientId, clientSecret)
      } else if (!configured) {
        // 심어둔 값이 없다. 이때 처음으로 입력칸을 보여준다.
        setShowSetup(true)
        setError('이 앱에 Google 클라이언트 ID가 설정되어 있지 않습니다.')
        return
      }

      const res = await window.heyu.auth.signIn()
      if (res.ok && res.profile) {
        onSignedIn(res.profile)
      } else {
        setError(res.error ?? '로그인에 실패했습니다.')
        const c = await window.heyu.auth.config()
        setConfigured(c.clientIdConfigured)
        // 저장한 클라이언트 ID 가 틀렸을 수도 있으니 입력칸을 열어둔다.
        if (!c.clientIdConfigured) setShowSetup(true)
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
        </p>

        <button className="btn-google" onClick={() => void signIn()} disabled={busy}>
          <GoogleMark />
          <span>{busy ? '로그인 중…' : 'Google 계정으로 로그인'}</span>
        </button>

        {domains.length > 0 && (
          <p className="gate-note">
            {domains.map((d) => '@' + d).join(', ')} 계정만 사용할 수 있습니다.
          </p>
        )}

        {error && <div className="gate-error">{error}</div>}

        {showSetup && (
          <div className="gate-setup">
            <div className="label">Google OAuth 클라이언트</div>
            <input
              className="field"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="클라이언트 ID (....apps.googleusercontent.com)"
              style={{ marginBottom: 8 }}
              autoFocus
            />
            <input
              className="field"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="클라이언트 보안 비밀 (선택)"
            />
            <div className="hint">
              Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID → 애플리케이션 유형을{' '}
              <b>데스크톱 앱</b>으로 만드세요. 한 번만 입력하면 됩니다.
              <br />
              배포 빌드라면 <code>.env</code> 에 <code>GOOGLE_CLIENT_ID</code> 를 넣어
              이 칸이 아예 뜨지 않게 하세요.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
