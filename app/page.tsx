'use client'

import { useState, useEffect } from 'react'
import UploadZone from './components/UploadZone'
import DocumentList from './components/DocumentList'
import QueryInterface from './components/QueryInterface'

interface Document {
  id: string
  name: string
  file_type: string
  chunk_count: number
  created_at: string
}

export default function Home() {
  const [documents, setDocuments] = useState<Document[]>([])

  useEffect(() => {
    fetch('/api/documents')
      .then(r => r.json())
      .then(data => setDocuments(data.documents || []))
  }, [])

  const handleUploadSuccess = (doc: { id: string; name: string; chunk_count: number }) => {
    setDocuments(prev => [
      { ...doc, file_type: doc.name.endsWith('.pdf') ? 'pdf' : 'txt', created_at: new Date().toISOString() },
      ...prev,
    ])
  }

  const handleDelete = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">RAG Knowledge Base</h1>
            <p className="text-xs text-gray-500">Upload documents · Ask questions · Get cited answers</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-120px)]">

          {/* Left panel — documents */}
          <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4 overflow-hidden">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Upload Document</h2>
              <UploadZone onUploadSuccess={handleUploadSuccess} />
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">
                Documents
                {documents.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">{documents.length}</span>
                )}
              </h2>
              <div className="flex-1 overflow-y-auto">
                <DocumentList documents={documents} onDelete={handleDelete} />
              </div>
            </div>
          </div>

          {/* Right panel — chat */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 flex flex-col overflow-hidden">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Ask a Question</h2>
            <div className="flex-1 overflow-hidden flex flex-col">
              <QueryInterface />
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
