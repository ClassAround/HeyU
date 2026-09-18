import { useEffect, useState } from 'react'
import type { CredentialStatus } from '../../../shared/types'

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
  const [heygen, setHeygen] = useState('')
  const [openai, setOpenai] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.heyu.auth.allowedDomains().then((d) => setDomains(d.join(', ')))
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (heygen.trim()) {
        const res = await window.heyu.creds.setHeygen(heygen)
        if (!res.ok) {
          setError(res.error ?? 'HeyGen 키 검증에 실패했습니다.')
          return
        }
      }
      if (openai.trim()) await window.heyu.creds.setOpenai(openai)
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
          키는 OS 보안 저장소(macOS 키체인 / Windows DPAPI)로 암호화되어 이 PC에만 저장됩니다.
        </p>

        <div className="group">
          <div className="label">
            HeyGen API 키 {mark(status.heygen)}
          </div>
          <input
            className="field"
            type="password"
            value={heygen}
            onChange={(e) => setHeygen(e.target.value)}
            placeholder={status.heygen ? '변경하려면 새 키 입력' : 'HeyGen API 키'}
          />
          <div className="hint">
            더빙에 반드시 필요합니다. HeyGen 대시보드 → Settings → API 에서 발급합니다. 저장 시
            실제로 호출해 유효성을 확인합니다.
          </div>
        </div>

        <div className="group">
          <div className="label">
            OpenAI API 키 {mark(status.openai)}
          </div>
          <input
            className="field"
            type="password"
            value={openai}
            onChange={(e) => setOpenai(e.target.value)}
            placeholder={status.openai ? '변경하려면 새 키 입력' : 'sk-...'}
          />
          <div className="hint">
            대화형 조작에만 쓰입니다. 비워두면 오른쪽 채팅만 비활성화되고 더빙은 정상 동작합니다.
            ChatGPT Plus 구독과는 별개로 종량 과금됩니다.
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
