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
    return (
      <div className="empty-docs">
        <div className="box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
            <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          </svg>
        </div>
        <p><b>No documents yet</b>Upload a file to build your knowledge base.</p>
      </div>
    )
  }

  return (
    <ul className="doclist">
      {documents.map(doc => (
        <li key={doc.id} className="docrow">
          <span className="ftype">{doc.file_type}</span>
          <span className="dname" title={doc.name}>{doc.name}</span>

          {doc.status === 'processing' && (
            <span className="dstatus processing"><span className="pdot" />processing</span>
          )}
          {doc.status === 'ready' && (
            <span className="dstatus ready">{doc.chunk_count} chunks</span>
          )}
          {doc.status === 'failed' && (
            <span className="dstatus failed" title={doc.error_message || 'Processing failed'}>failed</span>
          )}

          <button
            onClick={() => handleDelete(doc.id)}
            disabled={deleting === doc.id}
            className="del-btn"
            title="Delete document"
          >
            {deleting === doc.id ? '…' : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
