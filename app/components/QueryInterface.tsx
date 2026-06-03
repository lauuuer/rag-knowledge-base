'use client'

import { useState, useRef } from 'react'
import { ownedFetch } from '@/lib/owner'

interface Source {
  document_name: string
  chunk_index: number
  excerpt: string
  similarity: number
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

const SUGGESTIONS = [
  'Summarize the key points',
  'What does it say about pricing?',
  'List every deadline mentioned',
]

export default function QueryInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const sendQuestion = async () => {
    const question = input.trim()
    if (!question || isLoading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setIsLoading(true)
    requestAnimationFrame(scrollToBottom)

    // Index of the assistant message we are about to stream into.
    let assistantIndex = -1
    const startAssistant = () => {
      setMessages(prev => {
        assistantIndex = prev.length
        return [...prev, { role: 'assistant', content: '', sources: [] }]
      })
    }

    try {
      const res = await ownedFetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      // Validation/retrieval errors come back as plain JSON with a non-2xx status.
      if (!res.ok || !res.body) {
        let msg = 'Error.'
        try {
          const data = await res.json()
          msg = data.error || msg
        } catch {
          /* keep default */
        }
        setMessages(prev => [...prev, { role: 'assistant', content: msg }])
        return
      }

      startAssistant()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // Apply a parsed SSE event to the streaming assistant message.
      const applyEvent = (eventName: string, dataRaw: string) => {
        let payload: any = {}
        try {
          payload = JSON.parse(dataRaw)
        } catch {
          return
        }

        setMessages(prev => {
          const next = [...prev]
          const msg = next[assistantIndex]
          if (!msg) return prev

          if (eventName === 'sources') {
            next[assistantIndex] = { ...msg, sources: payload }
          } else if (eventName === 'delta') {
            next[assistantIndex] = { ...msg, content: msg.content + (payload.text ?? '') }
          } else if (eventName === 'error') {
            next[assistantIndex] = {
              ...msg,
              content: msg.content + `\n\n[${payload.message || 'Stream error.'}]`,
            }
          }
          return next
        })

        // When the stream finishes, the server sends the updated spend total.
        // Broadcast it so the budget indicator in the header can refresh without
        // a page reload. We pass the value along so the badge can show it
        // immediately instead of making another round-trip.
        if (eventName === 'done') {
          window.dispatchEvent(
            new CustomEvent('usage-updated', { detail: { spent: payload.spent } })
          )
        }

        if (eventName === 'delta' || eventName === 'sources') {
          scrollToBottom()
        }
      }

      // Parse one raw SSE record ("event: x\ndata: y") and dispatch it.
      const parseRecord = (record: string) => {
        let eventName = 'message'
        const dataLines: string[] = []
        for (const line of record.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length) applyEvent(eventName, dataLines.join('\n'))
      }

      // Read the stream and split it into SSE records (separated by a blank line).
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const record = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          parseRecord(record)
        }
      }

      // The stream can close without a trailing blank line, leaving the last
      // record (often the `done` event carrying the spend total) stuck in the
      // buffer. Flush it so that final event is never dropped.
      buffer += decoder.decode()
      if (buffer.trim().length) parseRecord(buffer)
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error. Please try again.' }])
    } finally {
      setIsLoading(false)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="chat">
      <div className="chat-head">
        <h2 className="panel-title">Ask a question</h2>
        <span className={`pill${isLoading ? ' live' : ''}`}>
          <span className="d" />
          {isLoading ? 'Retrieving…' : 'Idle · grounded answers only'}
        </span>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {isEmpty ? (
          <div className="chat-empty">
            <div className="welcome">
              <div className="glow-ic">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <h2>What do you want to know?</h2>
              <p>Upload a document on the left, then ask anything about it. Answers stream in with the exact source cited.</p>
              <div className="suggest">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="chip" onClick={() => setInput(s)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3-3" strokeLinecap="round" />
                    </svg>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="msgs">
            {messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.role}`}>
                <div className="msg-col">
                  <div className="bubble">{msg.content}</div>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="sources">
                      <div className="s-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Sources
                      </div>
                      {msg.sources.map((s, j) => (
                        <div key={j} className="source">
                          <div className="s-top">
                            <span className="s-name">{s.document_name}</span>
                            <span className="s-match">{Math.round(s.similarity * 100)}% match</span>
                          </div>
                          <p className="s-ex">{s.excerpt}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="msg assistant">
                <div className="msg-col">
                  <div className="bubble" style={{ padding: 0 }}>
                    <div className="typing"><span /><span /><span /></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="composer">
        <div className="inputwrap">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendQuestion()}
            placeholder="Ask a question about your documents…"
            disabled={isLoading}
          />
          <button className="send" onClick={sendQuestion} disabled={isLoading || !input.trim()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        </div>
        <div className="foot">Press <span className="k">Enter</span> to ask · answers are grounded only in your uploaded documents</div>
      </div>
    </div>
  )
}
