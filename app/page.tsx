'use client'

import { useState, useEffect } from 'react'
import UploadZone from './components/UploadZone'
import DocumentList from './components/DocumentList'
import QueryInterface from './components/QueryInterface'
import { AuthGate, UserBadge } from './components/AuthGate'
import { ownedFetch } from '@/lib/owner' // now token-based via the shim

interface Document {
  id: string
  name: string
  file_type: string
  chunk_count: number
  status: 'processing' | 'ready' | 'failed'
  error_message?: string | null
  created_at: string
}

function Dashboard() {
  const [documents, setDocuments] = useState<Document[]>([])

  const refetch = () =>
    ownedFetch('/api/documents')
      .then(r => r.json())
      .then(data => setDocuments(data.documents || []))
      .catch(() => {})

  useEffect(() => {
    refetch()
  }, [])

  useEffect(() => {
    const anyProcessing = documents.some(d => d.status === 'processing')
    if (!anyProcessing) return
    const t = setInterval(refetch, 2000)
    return () => clearInterval(t)
  }, [documents])

  const handleUploadSuccess = () => {
    refetch()
  }

  const handleDelete = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="mark sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="6" cy="6" r="2.4" fill="#0a0a12" />
            <circle cx="18" cy="9" r="2" fill="#0a0a12" />
            <circle cx="9" cy="18" r="2" fill="#0a0a12" />
            <path d="M7.6 7.4 16 8.6M7.6 16.6 9 9.4" stroke="#0a0a12" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="name">RAG Knowledge Base<span>Upload · Ask · Get cited answers</span></div>
        <UserBadge />
      </header>

      <main className="work">
        {/* Left: upload + documents */}
        <aside className="panel">
          <div className="panel-pad">
            <h2 className="panel-title">Upload document</h2>
            <UploadZone onUploadSuccess={handleUploadSuccess} />

            <div className="docs">
              <h2 className="panel-title">
                Documents
                {documents.length > 0 && <span className="count">{documents.length}</span>}
              </h2>
              <div className="docs-list-wrap">
                <DocumentList documents={documents} onDelete={handleDelete} />
              </div>
            </div>
          </div>
        </aside>

        {/* Right: chat */}
        <section className="panel chat">
          <QueryInterface />
        </section>
      </main>
    </div>
  )
}

export default function Home() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  )
}
