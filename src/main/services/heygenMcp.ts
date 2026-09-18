import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { store } from '../store.js'
import {
  MCP_ENDPOINT,
  connectHeyGenMcp,
  fetchAccountLabel,
  isExpired,
  refreshTokens,
  revokeTokens,
  type McpClientInfo,
  type McpTokens
} from '../auth/heygenMcp.js'
import type { McpStatus, McpToolInfo } from '../../shared/types.js'

/**
 * HeyGen MCP 세션.
 *
 * 왜 이 레이어가 따로 있는가 — services/heygen.ts 는 더빙 한 가지를 REST 로 직접 친다.
 * 그 경로는 그대로 두는 게 맞다(예측 가능하고, 진행률을 단계별로 보여줄 수 있다).
 * MCP 는 그 외의 것 — 아바타 목록, 음성 복제, 자막 등 100개 넘는 도구를
 * 우리가 하나씩 래핑하지 않고 대화로 쓰기 위한 통로다.
 *
 * 연결은 **게으르게** 맺는다. 앱이 켜질 때마다 세션을 여는 것은
 * 쓰지도 않을 토큰을 굳이 갱신하는 일이고, 첫 화면을 느리게 만든다.
 */

let live: Client | null = null
let transport: StreamableHTTPClientTransport | null = null
/** 동시에 두 번 연결하지 않도록 진행 중인 연결을 공유한다. */
let connecting: Promise<Client> | null = null

function savedClient(): McpClientInfo | null {
  return store.get('heygenMcpClient') ?? null
}

function savedTokens(): McpTokens | null {
  return store.get('heygenMcpTokens') ?? null
}

async function closeSession(): Promise<void> {
  const t = transport
  live = null
  transport = null
  if (t) await t.close().catch(() => {})
}

/**
 * 유효한 액세스 토큰을 확보한다.
 * 만료가 임박했으면 먼저 갱신한다 — 401 을 맞고 되돌아오는 것보다 싸다.
 */
async function freshAccessToken(): Promise<string> {
  const client = savedClient()
  const tokens = savedTokens()
  if (!client || !tokens) throw new Error('HeyGen 계정이 연결되지 않았습니다.')
  if (!isExpired(tokens)) return tokens.accessToken

  const next = await refreshTokens(client, tokens)
  store.set('heygenMcpTokens', next)
  return next.accessToken
}

async function openSession(): Promise<Client> {
  const accessToken = await freshAccessToken()

  const client = new Client({ name: 'RAWCUT GLOBAL', version: '0.1.0' }, { capabilities: {} })
  const t = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } }
  })
  await client.connect(t)

  live = client
  transport = t
  return client
}

/**
 * 살아 있는 세션을 돌려준다.
 *
 * 401 은 한 번만 재시도한다 — 만료가 아니라 권한이 회수된 경우에는
 * 몇 번을 다시 해도 같은 결과이고, 사용자에게 재연결을 요구해야 한다.
 */
async function session(retryOnAuthError = true): Promise<Client> {
  if (live) return live
  if (connecting) return connecting

  connecting = openSession().finally(() => {
    connecting = null
  })

  try {
    return await connecting
  } catch (e) {
    await closeSession()
    const msg = e instanceof Error ? e.message : String(e)
    if (retryOnAuthError && /401|unauthor/i.test(msg)) {
      const client = savedClient()
      const tokens = savedTokens()
      if (client && tokens?.refreshToken) {
        // 만료 시각을 못 받아서 낡은 토큰을 들고 있었을 수 있다. 한 번 갱신하고 다시 시도한다.
        store.set('heygenMcpTokens', await refreshTokens(client, tokens))
        return session(false)
      }
    }
    throw e
  }
}

export const heygenMcp = {
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const client = await session()
    return client.callTool({ name, arguments: args }, undefined, { signal })
  },
  status(): McpStatus {
    const tokens = savedTokens()
    // 이전 버전이 불투명한 sub 를 저장해 두었을 수 있다. 사람이 읽을 수 있는 값만 내보낸다.
    const saved = store.get('heygenMcpAccount')
    return {
      connected: Boolean(savedClient() && tokens),
      account: saved?.includes('@') ? saved : undefined,
      expiresAt: tokens?.expiresAt
    }
  },

  /** 브라우저 로그인을 띄우고 성공하면 자격증명을 저장한다. */
  async connect(): Promise<McpStatus> {
    await closeSession()
    const { client, tokens } = await connectHeyGenMcp()
    store.set('heygenMcpClient', client)
    store.set('heygenMcpTokens', tokens)

    const account = await fetchAccountLabel(tokens)
    if (account) store.set('heygenMcpAccount', account)

    // 연결 직후 한 번 세션을 열어 실제로 통하는지 확인한다.
    // 여기서 실패하면 저장된 토큰은 쓸모가 없으므로 지우고 실패로 처리한다.
    try {
      await session()
    } catch (e) {
      await heygenMcp.disconnect()
      throw e
    }
    return heygenMcp.status()
  },

  async disconnect(): Promise<void> {
    const client = savedClient()
    const tokens = savedTokens()
    await closeSession()
    if (client && tokens) await revokeTokens(client, tokens).catch(() => {})
    store.clear('heygenMcpClient')
    store.clear('heygenMcpTokens')
    store.clear('heygenMcpAccount')
  },

  /**
 * 서버가 제공하는 도구 목록.
 *
 * 연결 상태를 확인하고 서버의 제공 기능을 조회한다.
 */
  async tools(): Promise<McpToolInfo[]> {
    const client = await session()
    const { tools } = await client.listTools()
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>
    }))
  },
}
