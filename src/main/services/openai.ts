import type { DubOptions } from '../../shared/types.js'

/**
 * OpenAI 대화 오케스트레이터.
 *
 * 개인 ChatGPT 구독(Plus/Pro)은 OpenAI 자사 제품에서만 쓸 수 있고
 * 서드파티 앱에서는 Platform API 키로만 호출할 수 있다. 여기서 쓰는 키는
 * 구독과 별개로 종량 과금된다 — README 의 "비용" 항목 참고.
 *
 * 프롬프트 캐싱을 위해 정적 지시문을 시스템 메시지 최상단에 고정하고,
 * 바뀌는 앱 상태는 마지막 메시지로 내려보낸다. 상단이 1바이트라도
 * 바뀌면 그 뒤 캐시가 전부 무효화되기 때문이다.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/** 절대 변하지 않아야 하는 부분. 타임스탬프·세션ID를 넣지 말 것. */
const SYSTEM_PROMPT = `너는 HeyU 데스크톱 앱에 내장된 어시스턴트다.
HeyU 는 사용자가 고른 영상을 영어 립싱크 더빙으로 바꿔주는 도구다.

원칙:
- 사용자가 더빙을 원하면 설명만 하지 말고 start_dub 도구를 호출해라.
- 영상이 선택되지 않았으면 먼저 영상을 고르라고 안내해라.
- 진행 상황을 물으면 get_job_status 를 호출해 실제 상태를 확인하고 답해라.
- 답변은 한국어로, 간결하게. 사용자는 결과물을 원하지 과정 설명을 원하지 않는다.
- 립싱크 품질이 중요하면 precision, 속도가 중요하면 speed 모드를 권해라.
- 크레딧 비용을 묻거든: 립싱크 포함 분당 5크레딧이라고 답해라.`

export interface ToolContext {
  startDub(opts: DubOptions): Promise<string>
  getJobStatus(): Promise<string>
  hasVideo(): boolean
  videoSummary(): string
}

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'start_dub',
      description:
        '현재 선택된 영상을 영어 립싱크 더빙으로 변환하는 작업을 시작한다. 사용자가 더빙을 요청하면 호출한다.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['speed', 'precision'],
            description: 'precision 은 립싱크 품질이 높고 느리다. 기본은 precision.'
          },
          use_stock_voice: {
            type: 'boolean',
            description: '원본 화자 목소리를 복제하지 않고 HeyGen 프리셋 음성을 쓸지. 기본 false.'
          },
          remove_music: {
            type: 'boolean',
            description: '배경 음악 트랙을 제거할지. 기본 false.'
          }
        },
        required: ['mode']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_job_status',
      description: '진행 중이거나 마지막으로 끝난 더빙 작업의 상태를 조회한다.',
      parameters: { type: 'object', properties: {} }
    }
  }
]

interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface ChatTurn {
  reply: string
  toolNotes: string[]
}

export class OpenAIClient {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'gpt-4.1-mini'
  ) {
    if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다.')
  }

  private async call(messages: ApiMessage[], signal?: AbortSignal): Promise<any> {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, messages, tools: TOOLS, temperature: 0.3 })
    })

    const body = (await res.json()) as any
    if (!res.ok) {
      throw new Error(body?.error?.message ?? `OpenAI 요청 실패 (HTTP ${res.status})`)
    }
    return body.choices[0].message
  }

  /**
   * 한 번의 사용자 발화를 처리한다. 도구 호출이 나오면 실행하고
   * 결과를 다시 넣어 최종 답변이 나올 때까지 반복한다.
   */
  async chat(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    userInput: string,
    ctx: ToolContext,
    signal?: AbortSignal
  ): Promise<ChatTurn> {
    const messages: ApiMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      // 동적 상태는 캐시 접두사를 깨지 않도록 항상 맨 아래에 둔다.
      { role: 'system', content: `현재 앱 상태: ${ctx.videoSummary()}` },
      { role: 'user', content: userInput }
    ]

    const toolNotes: string[] = []

    // 도구 호출이 연쇄될 수 있으므로 상한을 둔다. 무한 루프 방지.
    for (let hop = 0; hop < 5; hop++) {
      const msg = await this.call(messages, signal)

      if (!msg.tool_calls?.length) {
        return { reply: msg.content ?? '', toolNotes }
      }

      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })

      for (const tc of msg.tool_calls) {
        let result: string
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
          if (tc.function.name === 'start_dub') {
            if (!ctx.hasVideo()) {
              result = '영상이 선택되지 않았습니다. 사용자에게 영상을 먼저 고르라고 안내하세요.'
            } else {
              result = await ctx.startDub({
                mode: args.mode === 'speed' ? 'speed' : 'precision',
                useStockVoice: Boolean(args.use_stock_voice),
                removeMusic: Boolean(args.remove_music)
              })
              toolNotes.push('더빙 작업을 시작했습니다')
            }
          } else if (tc.function.name === 'get_job_status') {
            result = await ctx.getJobStatus()
            toolNotes.push('작업 상태를 확인했습니다')
          } else {
            result = `알 수 없는 도구: ${tc.function.name}`
          }
        } catch (e) {
          result = `도구 실행 실패: ${e instanceof Error ? e.message : String(e)}`
        }

        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
    }

    return { reply: '요청을 처리하지 못했습니다. 다시 시도해 주세요.', toolNotes }
  }
}
