'use client'

import { useState } from 'react'
import { ownedFetch } from '@/lib/owner'

interface Document {
  id: string
  name: string
  file_type: string
  chunk_count: number
  status: 'processing' | 'ready' | 'failed'
  error_message?: string | null
  created_at: string
}

interface DocumentListProps {
  documents: Document[]
  onDelete: (id: string) => void
}

export default function DocumentList({ documents, onDelete }: DocumentListProps) {
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      const res = await ownedFetch(`/api/documents?id=${id}`, { method: 'DELETE' })
      // Only drop it from the list if the server confirms the delete. A 404
      // (not this owner's document) or 429 leaves the list untouched.
      if (res.ok) onDelete(id)
    } finally {
      setDeleting(null)
    }
  }

  if (documents.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No documents uploaded yet.</p>
  }

  return (
    <ul className="divide-y divide-gray-100">
      {documents.map(doc => (
        <li key={doc.id} className="flex items-center justify-between py-2.5 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase">
              {doc.file_type}
            </span>
            <span className="truncate text-gray-800">{doc.name}</span>
            {doc.status === 'processing' && (
              <span className="text-amber-600 shrink-0 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                processing
              </span>
            )}
            {doc.status === 'ready' && (
              <span className="text-gray-400 shrink-0">{doc.chunk_count} chunks</span>
            )}
            {doc.status === 'failed' && (
              <span className="text-red-500 shrink-0" title={doc.error_message || 'Processing failed'}>
                failed
              </span>
            )}
          </div>
          <button
            onClick={() => handleDelete(doc.id)}
            disabled={deleting === doc.id}
            className="ml-3 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40 shrink-0"
            title="Delete document"
          >
            {deleting === doc.id ? '…' : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
