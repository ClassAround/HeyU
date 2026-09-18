import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'

interface Props {
  enabled: boolean
  onOpenSettings: () => void
}

/** 대화로 더빙을 지시하는 패널. OpenAI 키가 없으면 비활성화되고 더빙 자체는 영향 없다. */
export default function Chat({ enabled, onOpenSettings }: Props): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || busy) return

    // 히스토리는 도구 호출 기록 없이 평문만 보낸다 — 토큰을 아끼고 캐시 접두사를 안정시킨다.
    const history = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setBusy(true)

    try {
      const res = await window.heyu.chat.send(history, text)
      setMessages((prev) => [
        ...prev,
        res.ok
          ? {
              role: 'assistant',
              content: res.reply ?? '',
              toolNote: res.toolNotes?.length ? res.toolNotes.join(' · ') : undefined
            }
          : { role: 'assistant', content: `오류: ${res.error}` }
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pane">
      <div className="chat">
        <div className="label">어시스턴트</div>

        <div className="log" ref={logRef}>
          {!enabled ? (
            <div className="empty">
              OpenAI API 키를 설정하면 대화로 더빙을 지시할 수 있습니다.
              <br />
              <button
                className="btn sm"
                style={{ marginTop: 14 }}
                onClick={onOpenSettings}
              >
                설정 열기
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty">
              “이 영상 영어로 더빙해줘”처럼 말해보세요.
              <br />
              진행 상황도 물어볼 수 있습니다.
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content}
                {m.toolNote && <div className="tool">↳ {m.toolNote}</div>}
              </div>
            ))
          )}
          {busy && <div className="msg assistant" style={{ color: 'var(--text-faint)' }}>…</div>}
        </div>

        <div className="composer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send()}
            placeholder={enabled ? '메시지를 입력하세요' : 'OpenAI 키 필요'}
            disabled={!enabled || busy}
          />
          <button className="btn primary" onClick={() => void send()} disabled={!enabled || busy}>
            보내기
          </button>
        </div>
      </div>
    </div>
  )
}
