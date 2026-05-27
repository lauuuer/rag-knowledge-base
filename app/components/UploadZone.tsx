'use client'

import { useState, useCallback } from 'react'

interface UploadedDoc {
  id: string
  name: string
  chunk_count: number
}

interface UploadZoneProps {
  onUploadSuccess: (doc: UploadedDoc) => void
}

export default function UploadZone({ onUploadSuccess }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setIsUploading(true)
      setStatus(null)

      const formData = new FormData()
      formData.append('file', file)

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData })
        const data = await res.json()

        if (!res.ok) {
          setStatus({ type: 'error', message: data.error || 'Upload failed.' })
          return
        }

        setStatus({
          type: 'success',
          message: `"${data.document.name}" ingested — ${data.document.chunk_count} chunks`,
        })
        onUploadSuccess(data.document)
      } catch {
        setStatus({ type: 'error', message: 'Network error. Please try again.' })
      } finally {
        setIsUploading(false)
      }
    },
    [onUploadSuccess]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-3">
      <label
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-lg cursor-pointer transition-colors
          ${isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}
          ${isUploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          type="file"
          accept=".pdf,.txt"
          className="hidden"
          onChange={onInputChange}
          disabled={isUploading}
        />
        <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {isUploading ? (
          <p className="text-sm text-indigo-600 font-medium">Processing…</p>
        ) : (
          <>
            <p className="text-sm text-gray-600">Drop a file or <span className="text-indigo-600 font-medium">click to browse</span></p>
            <p className="text-xs text-gray-400 mt-1">PDF or TXT · max 10 MB</p>
          </>
        )}
      </label>

      {status && (
        <p className={`text-sm px-3 py-2 rounded ${
          status.type === 'success'
            ? 'bg-green-50 text-green-700'
            : 'bg-red-50 text-red-700'
        }`}>
          {status.message}
        </p>
      )}
    </div>
  )
}
