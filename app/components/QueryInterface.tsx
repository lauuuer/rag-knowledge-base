'use client'

import { useState, useRef } from 'react'

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

export default function QueryInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const sendQuestion = async () => {
    const question = input.trim()
    if (!question || isLoading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setIsLoading(true)

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.error || 'Error.' }])
        return
      }

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.answer, sources: data.sources },
      ])

      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error. Please try again.' }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm pt-12">
            <p>Upload a document, then ask anything about it.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] space-y-2 flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                {msg.content}
              </div>

              {msg.sources && msg.sources.length > 0 && (
                <div className="space-y-1 w-full">
                  <p className="text-xs text-gray-400 font-medium">Sources</p>
                  {msg.sources.map((s, j) => (
                    <div key={j} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-800 truncate">{s.document_name}</span>
                        <span className="text-gray-400 shrink-0 ml-2">{Math.round(s.similarity * 100)}% match</span>
                      </div>
                      <p className="text-gray-500 line-clamp-2">{s.excerpt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">·</span>
                <span className="animate-bounce [animation-delay:0.1s]">·</span>
                <span className="animate-bounce [animation-delay:0.2s]">·</span>
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 pt-3 border-t border-gray-100">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendQuestion()}
          placeholder="Ask a question about your documents…"
          disabled={isLoading}
          className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
        />
        <button
          onClick={sendQuestion}
          disabled={isLoading || !input.trim()}
          className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Ask
        </button>
      </div>
    </div>
  )
}
