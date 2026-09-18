import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { shell } from 'electron'
import type { AddressInfo } from 'node:net'

/**
 * HeyGen MCP 서버용 OAuth 2.1 (RFC 8252 + RFC 7591 DCR + RFC 8707 resource).
 *
 * 왜 이게 되는가 — HeyGen 인증 서버가 **동적 클라이언트 등록(DCR)** 을 지원한다.
 * 즉 우리가 미리 클라이언트를 만들어 둘 필요도, 그걸 중개할 서버도 없다.
 * 데스크톱 앱이 실행 시점에 스스로 등록하고 PKCE 로 로그인한다.
 *
 * 이 경로의 실질적 이득: 사용자가 **API 키를 복사·붙여넣지 않는다.**
 * 회사 Business 워크스페이스에 팀원을 초대해 두면 각자 자기 계정으로 로그인하고
 * 크레딧 풀은 공유되며, 회사 API 키는 누구에게도 배포되지 않는다.
 *
 * 구조는 auth/google.ts 와 의도적으로 같다(루프백 + PKCE). 다른 점만 적는다:
 *  - 클라이언트 ID 를 우리가 등록해서 받아온다 (Google 은 사람이 콘솔에서 만든다)
 *  - 토큰이 만료되므로 refresh_token 을 실제로 쓴다 (Google 쪽은 신원 확인뿐이라 안 쓴다)
 *  - resource 파라미터로 "이 토큰은 MCP 서버용"임을 못박는다 (혼동된 대리인 방지)
 */

/**
 * resource 파라미터에 넣는 값. 보호 자원 메타데이터가 알려주는 식별자와 **정확히** 같아야 한다
 * (끝 슬래시가 없다). 실제로 요청을 보내는 주소와는 다르다 — 아래 MCP_ENDPOINT 참고.
 */
export const MCP_RESOURCE = 'https://mcp.heygen.com/mcp/v1'

/** 슬래시를 빼면 307 리다이렉트를 타서 매 요청이 두 번 나간다. 처음부터 붙여서 보낸다. */
export const MCP_ENDPOINT = 'https://mcp.heygen.com/mcp/v1/'
const AUTH_SERVER = 'https://api2.heygen.com'
const PROTECTED_RESOURCE_METADATA =
  'https://mcp.heygen.com/.well-known/oauth-protected-resource/mcp/v1'

/** 브라우저를 열어두고 사람이 로그인할 때까지 기다리는 시간. */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000

/** 만료 직전 토큰으로 요청을 보내 실패하는 일이 없도록 하는 여유분. */
const EXPIRY_SKEW_MS = 60 * 1000

export interface McpTokens {
  accessToken: string
  refreshToken?: string
  /** epoch ms. 만료 정보가 없으면 undefined — 그때는 401 을 보고 갱신한다. */
  expiresAt?: number
  scope?: string
}

export interface McpClientInfo {
  clientId: string
  /** 공개 클라이언트면 없다. HeyGen 은 현재 none 으로 등록된다. */
  clientSecret?: string
}

interface AuthServerMetadata {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  revocation_endpoint?: string
  userinfo_endpoint?: string
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text()
  let body: any
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`${what} 응답을 해석하지 못했습니다 (HTTP ${res.status}).`)
  }
  if (!res.ok) {
    throw new Error(
      body?.error_description ?? body?.error ?? body?.message ?? `${what} 실패 (HTTP ${res.status})`
    )
  }
  return body as T
}

/**
 * 인증 서버 메타데이터를 가져온다.
 *
 * 엔드포인트를 상수로 박지 않는 이유 — HeyGen 이 경로를 옮기면 앱이 통째로 죽는다.
 * 보호 자원 메타데이터가 인증 서버를 가리키고, 거기서 실제 엔드포인트를 읽는다.
 * 이게 MCP 인가 명세가 요구하는 순서이기도 하다.
 */
async function discover(): Promise<AuthServerMetadata> {
  let issuer = AUTH_SERVER
  try {
    const prm = await fetch(PROTECTED_RESOURCE_METADATA)
    if (prm.ok) {
      const meta = (await prm.json()) as { authorization_servers?: string[] }
      if (meta.authorization_servers?.[0]) issuer = meta.authorization_servers[0]
    }
  } catch {
    // 메타데이터를 못 읽어도 기본 발급자로 계속 간다. 여기서 끝낼 이유가 없다.
  }

  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`)
  const meta = await json<AuthServerMetadata>(res, 'HeyGen 인증 서버 정보 조회')
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('HeyGen 인증 서버가 필요한 엔드포인트를 알려주지 않았습니다.')
  }
  return meta
}

/**
 * 이 앱을 클라이언트로 등록한다.
 *
 * redirect_uri 가 등록 내용에 포함되므로 **루프백 포트가 정해진 뒤**에 불러야 한다.
 * 그래서 매 로그인마다 새로 등록한다 — 포트는 OS 가 고르고 매번 달라진다.
 * 등록은 무료이고 즉시 끝나며, 받은 client_id 는 저장해 두면
 * 이후 토큰 갱신(refresh)에는 redirect_uri 없이 그대로 쓸 수 있다.
 */
async function register(endpoint: string, redirectUri: string): Promise<McpClientInfo> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'RAWCUT GLOBAL',
      client_uri: 'https://github.com/titanz/rawcut-global',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      scope: 'openid profile email'
    })
  })
  const body = await json<{ client_id: string; client_secret?: string }>(res, 'HeyGen 클라이언트 등록')
  if (!body.client_id) throw new Error('HeyGen 이 클라이언트 ID를 돌려주지 않았습니다.')
  return { clientId: body.client_id, clientSecret: body.client_secret }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

function toTokens(body: TokenResponse, previous?: McpTokens): McpTokens {
  if (!body.access_token) throw new Error('HeyGen 이 액세스 토큰을 돌려주지 않았습니다.')
  return {
    accessToken: body.access_token,
    // 갱신 응답에 refresh_token 이 없으면 기존 것이 계속 유효하다는 뜻이다.
    refreshToken: body.refresh_token ?? previous?.refreshToken,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
    scope: body.scope ?? previous?.scope
  }
}

function resultPage(title: string, body: string, accent: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>RAWCUT GLOBAL</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#14161A;
       font-family:Pretendard,-apple-system,'Segoe UI',sans-serif;color:#E6E8EC}
  .card{text-align:center;padding:40px 48px}
  h1{font-size:20px;margin:0 0 8px;color:${accent}}
  p{margin:0;color:#8A919E;font-size:14px}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`
}

export interface McpAuthResult {
  client: McpClientInfo
  tokens: McpTokens
}

/**
 * 브라우저로 HeyGen 로그인을 진행하고 토큰을 받아온다.
 * 포트는 0 으로 바인딩해 OS 가 빈 포트를 고르게 한다 — 고정 포트는 충돌한다.
 */
export function connectHeyGenMcp(timeoutMs = AUTH_TIMEOUT_MS): Promise<McpAuthResult> {
  return new Promise<McpAuthResult>((resolve, reject) => {
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(16))

    let client: McpClientInfo | null = null
    let tokenEndpoint = ''
    let redirectUri = ''

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }

      const send = (html: string, code = 200): void => {
        res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }).end(html)
      }

      try {
        const err = url.searchParams.get('error')
        if (err) {
          throw new Error(
            `HeyGen 연결이 거부되었습니다: ${url.searchParams.get('error_description') ?? err}`
          )
        }

        // state 불일치는 CSRF 신호다. 토큰 교환 전에 끊는다.
        if (url.searchParams.get('state') !== state) {
          throw new Error('state 값이 일치하지 않습니다. 연결을 다시 시도해 주세요.')
        }

        const code = url.searchParams.get('code')
        if (!code) throw new Error('인증 코드를 받지 못했습니다.')
        if (!client) throw new Error('클라이언트 등록 정보가 없습니다.')

        const form = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: client.clientId,
          code_verifier: verifier,
          // 이 토큰이 MCP 서버 전용임을 못박는다. 다른 자원으로 재사용되지 않는다.
          resource: MCP_RESOURCE
        })
        if (client.clientSecret) form.set('client_secret', client.clientSecret)

        const tokenRes = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form
        })
        const tokens = toTokens(await json<TokenResponse>(tokenRes, 'HeyGen 토큰 교환'))

        send(resultPage('HeyGen 연결 완료', '이 창을 닫고 RAWCUT GLOBAL로 돌아가세요.', '#E8833A'))
        cleanup()
        resolve({ client, tokens })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        send(resultPage('HeyGen 연결 실패', msg, '#E05A4E'), 400)
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
      redirectUri = `http://127.0.0.1:${port}/callback`

      void (async () => {
        try {
          const meta = await discover()
          tokenEndpoint = meta.token_endpoint
          if (!meta.registration_endpoint) {
            throw new Error(
              'HeyGen 인증 서버가 동적 클라이언트 등록을 지원하지 않습니다. API 키 방식을 쓰세요.'
            )
          }
          client = await register(meta.registration_endpoint, redirectUri)

          const params = new URLSearchParams({
            response_type: 'code',
            client_id: client.clientId,
            redirect_uri: redirectUri,
            scope: 'openid profile email',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
            resource: MCP_RESOURCE
          })
          await shell.openExternal(`${meta.authorization_endpoint}?${params}`)
        } catch (e) {
          cleanup()
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })()

      timer = setTimeout(() => {
        server.close()
        reject(new Error('HeyGen 연결 시간이 초과되었습니다.'))
      }, timeoutMs)
    })
  })
}

/**
 * 연결된 계정 표시용 문자열을 가져온다.
 *
 * 실패해도 연결 자체는 성공이다 — 이건 UI 라벨일 뿐이고,
 * scope 에 따라 userinfo 가 이메일을 주지 않을 수도 있다.
 */
export async function fetchAccountLabel(tokens: McpTokens): Promise<string | undefined> {
  try {
    const meta = await discover()
    const endpoint = (meta as { userinfo_endpoint?: string }).userinfo_endpoint
    if (!endpoint) return undefined
    const res = await fetch(endpoint, {
      headers: { authorization: `Bearer ${tokens.accessToken}` }
    })
    if (!res.ok) return undefined
    const body = (await res.json()) as { email?: string; name?: string; sub?: string }
    // sub 는 불투명한 내부 ID(32자리 hex)다. 화면에 띄워봐야 사용자에게 아무 의미가 없다.
    // HeyGen 이 내주는 scope 가 openid 뿐이면 이메일이 없을 수 있다 — 그때는 라벨을 비운다.
    return body.email ?? body.name ?? undefined
  } catch {
    return undefined
  }
}

export function isExpired(tokens: McpTokens): boolean {
  if (!tokens.expiresAt) return false
  return Date.now() >= tokens.expiresAt - EXPIRY_SKEW_MS
}

/**
 * refresh_token 으로 액세스 토큰을 갱신한다.
 * 실패하면 사람이 다시 로그인해야 한다 — 호출부가 그 신호를 사용자에게 전달해야 한다.
 */
export async function refreshTokens(client: McpClientInfo, tokens: McpTokens): Promise<McpTokens> {
  if (!tokens.refreshToken) throw new Error('갱신 토큰이 없습니다. HeyGen 에 다시 연결해 주세요.')

  const meta = await discover()
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: client.clientId,
    resource: MCP_RESOURCE
  })
  if (client.clientSecret) form.set('client_secret', client.clientSecret)

  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form
  })
  return toTokens(await json<TokenResponse>(res, 'HeyGen 토큰 갱신'), tokens)
}

/** 연결 해제 시 서버 쪽 토큰도 무효화한다. 실패해도 로컬 삭제는 그대로 진행한다. */
export async function revokeTokens(client: McpClientInfo, tokens: McpTokens): Promise<void> {
  const meta = await discover()
  if (!meta.revocation_endpoint) return

  const form = new URLSearchParams({
    token: tokens.refreshToken ?? tokens.accessToken,
    token_type_hint: tokens.refreshToken ? 'refresh_token' : 'access_token',
    client_id: client.clientId
  })
  if (client.clientSecret) form.set('client_secret', client.clientSecret)

  await fetch(meta.revocation_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form
  })
}
