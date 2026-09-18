import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { shell } from 'electron'
import type { AddressInfo } from 'node:net'
import type { GoogleProfile } from '../../shared/types.js'

/**
 * 데스크톱 앱용 Google OAuth 2.0 (RFC 8252).
 *
 * 흐름: PKCE(S256) + 127.0.0.1 루프백 리다이렉트.
 * 임베디드 웹뷰를 쓰지 않는 이유 — Google 이 웹뷰 로그인을 차단하고,
 * 사용자가 주소창으로 도메인을 확인할 수 없어 피싱에 취약하다.
 *
 * client_secret 은 "데스크톱 앱" 클라이언트 유형에서도 발급되지만
 * Google 문서상 기밀로 취급되지 않는다. 실제 보호는 PKCE 가 한다.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const SCOPES = ['openid', 'email', 'profile']

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface GoogleAuthResult {
  profile: GoogleProfile
  refreshToken?: string
  accessToken: string
}

interface IdTokenClaims {
  email?: string
  email_verified?: boolean
  /** Google Workspace 호스팅 도메인. 개인 gmail 계정에는 없다. */
  hd?: string
  sub?: string
  name?: string
  picture?: string
}

/**
 * ID 토큰 페이로드를 읽는다.
 *
 * 서명을 따로 검증하지 않는 이유: 이 토큰은 리다이렉트로 받은 게 아니라
 * 우리가 Google 토큰 엔드포인트에 TLS 로 직접 요청해서 받은 응답이다.
 * Google 문서가 이 경우를 명시적 예외로 두고 있다. 만약 토큰을 제3자를
 * 거쳐 받게 구조가 바뀌면 그때는 JWKS 서명 검증을 반드시 붙여야 한다.
 */
function decodeIdToken(idToken: string): IdTokenClaims {
  const part = idToken.split('.')[1]
  if (!part) throw new Error('ID 토큰 형식이 올바르지 않습니다.')
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return JSON.parse(json) as IdTokenClaims
}

/**
 * 조직 계정만 통과시킨다.
 *
 * 주의 — 이 검사는 사용자 PC 위에서 돈다. 바이너리를 고치면 우회된다.
 * 즉 "권한 경계"가 아니라 "잘못된 문으로 들어오는 것을 막는 안내"다.
 * 진짜 차단이 필요하면 서버에서 걸러야 한다. README 참고.
 */
function assertAllowedDomain(claims: IdTokenClaims, allowed: string[]): void {
  if (allowed.length === 0) return

  const email = claims.email?.toLowerCase() ?? ''
  const wanted = allowed.map((d) => d.toLowerCase().replace(/^@/, ''))

  // hd 클레임이 1순위. Workspace 계정이면 반드시 있고, 위조할 수 없다.
  if (claims.hd && wanted.includes(claims.hd.toLowerCase())) {
    if (claims.email_verified === false) {
      throw new Error('이메일이 확인되지 않은 계정입니다.')
    }
    return
  }

  // hd 가 없는 경우(개인 계정 등)는 확인된 이메일의 도메인으로 판단한다.
  const domain = email.split('@')[1]
  if (domain && wanted.includes(domain) && claims.email_verified !== false) return

  throw new Error(
    `${wanted.map((d) => '@' + d).join(', ')} 계정으로만 로그인할 수 있습니다.` +
      (email ? ` (시도한 계정: ${email})` : '')
  )
}

function resultPage(title: string, body: string, accent: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>HeyU</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#14161A;
       font-family:Pretendard,-apple-system,'Segoe UI',sans-serif;color:#E6E8EC}
  .card{text-align:center;padding:40px 48px}
  h1{font-size:20px;margin:0 0 8px;color:${accent}}
  p{margin:0;color:#8A919E;font-size:14px}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`
}

/**
 * 브라우저 로그인 창을 띄우고 완료될 때까지 기다린다.
 * 포트는 0으로 바인딩해 OS가 빈 포트를 고르게 한다 — 고정 포트는 충돌한다.
 */
export function signInWithGoogle(
  clientId: string,
  clientSecret: string | undefined,
  allowedDomains: string[] = [],
  timeoutMs = 5 * 60 * 1000
): Promise<GoogleAuthResult> {
  return new Promise<GoogleAuthResult>((resolve, reject) => {
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(16))

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }

      const send = (html: string, code = 200): void => {
        res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }).end(html)
      }

      try {
        const err = url.searchParams.get('error')
        if (err) throw new Error(`Google 로그인이 거부되었습니다: ${err}`)

        // state 불일치는 CSRF 신호다. 토큰 교환 전에 끊는다.
        if (url.searchParams.get('state') !== state) {
          throw new Error('state 값이 일치하지 않습니다. 로그인을 다시 시도해 주세요.')
        }

        const code = url.searchParams.get('code')
        if (!code) throw new Error('인증 코드를 받지 못했습니다.')

        const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
        const form = new URLSearchParams({
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier
        })
        if (clientSecret) form.set('client_secret', clientSecret)

        const tokenRes = await fetch(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form
        })
        const tokens = (await tokenRes.json()) as {
          access_token?: string
          refresh_token?: string
          id_token?: string
          error_description?: string
          error?: string
        }
        if (!tokenRes.ok || !tokens.access_token) {
          throw new Error(tokens.error_description ?? tokens.error ?? '토큰 교환에 실패했습니다.')
        }

        // 도메인 제한은 사용자 정보를 더 가져오기 전에, 서명된 클레임으로 먼저 끊는다.
        if (allowedDomains.length > 0) {
          if (!tokens.id_token) throw new Error('ID 토큰을 받지 못해 도메인을 확인할 수 없습니다.')
          assertAllowedDomain(decodeIdToken(tokens.id_token), allowedDomains)
        }

        const profileRes = await fetch(USERINFO_ENDPOINT, {
          headers: { authorization: `Bearer ${tokens.access_token}` }
        })
        if (!profileRes.ok) throw new Error('사용자 정보를 가져오지 못했습니다.')
        const profile = (await profileRes.json()) as GoogleProfile

        send(resultPage('로그인 완료', '이 창을 닫고 HeyU로 돌아가세요.', '#E8833A'))
        cleanup()
        resolve({ profile, refreshToken: tokens.refresh_token, accessToken: tokens.access_token })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        send(resultPage('로그인 실패', msg, '#E05A4E'), 400)
        cleanup()
        reject(e instanceof Error ? e : new Error(msg))
      }
    })

    let timer: NodeJS.Timeout
    const cleanup = (): void => {
      clearTimeout(timer)
      // 브라우저가 응답을 받을 시간을 준 뒤 닫는다.
      setTimeout(() => server.close(), 300)
    }

    server.on('error', reject)

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // refresh_token 은 첫 동의 때만 내려온다. consent 를 강제해야 재로그인 시에도 받는다.
        access_type: 'offline',
        prompt: 'consent'
      })
      // hd 는 계정 선택 화면을 조직 계정으로 좁혀주는 힌트다.
      // 조작 가능하므로 실제 차단은 위의 assertAllowedDomain 이 담당한다.
      if (allowedDomains.length === 1) {
        params.set('hd', allowedDomains[0].replace(/^@/, ''))
      }
      void shell.openExternal(`${AUTH_ENDPOINT}?${params}`)

      timer = setTimeout(() => {
        server.close()
        reject(new Error('로그인 시간이 초과되었습니다.'))
      }, timeoutMs)
    })
  })
}
