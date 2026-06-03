'use client'

import { useState, useCallback } from 'react'
import { ownedFetch } from '@/lib/owner'

interface UploadedDoc {
  id: string
  name: string
  status?: string
  chunk_count?: number
}

interface UploadZoneProps {
  onUploadSuccess: (doc: UploadedDoc) => void
}

// How many files can be uploaded at once. Adjust as needed.
const MAX_FILES = 10

export default function UploadZone({ onUploadSuccess }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Uploads a single file. Returns true on success, or an error message.
  const uploadOne = useCallback(
    async (file: File): Promise<true | string> => {
      const formData = new FormData()
      formData.append('file', file)
      try {
        const res = await ownedFetch('/api/upload', { method: 'POST', body: formData })
        const data = await res.json()
        if (!res.ok) {
          return data.error || 'Upload failed.'
        }
        onUploadSuccess(data.document)
        return true
      } catch {
        return 'Network error.'
      }
    },
    [onUploadSuccess]
  )

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      let files = Array.from(fileList)
      if (files.length === 0) return

      let capNotice = ''
      if (files.length > MAX_FILES) {
        capNotice = ` (max ${MAX_FILES} at a time — ${files.length - MAX_FILES} extra file(s) skipped)`
        files = files.slice(0, MAX_FILES)
      }

      setIsUploading(true)
      setStatus(null)
      setProgress({ done: 0, total: files.length })

      const failures: string[] = []
      for (let i = 0; i < files.length; i++) {
        const result = await uploadOne(files[i])
        if (result !== true) failures.push(`"${files[i].name}": ${result}`)
        setProgress({ done: i + 1, total: files.length })
      }

      const ok = files.length - failures.length
      if (failures.length === 0) {
        setStatus({
          type: 'success',
          message: `${ok} file(s) uploaded — processing…${capNotice}`,
        })
      } else if (ok === 0) {
        setStatus({ type: 'error', message: `All uploads failed. ${failures[0]}` })
      } else {
        setStatus({
          type: 'error',
          message: `${ok} uploaded, ${failures.length} failed. ${failures[0]}${capNotice}`,
        })
      }

      setIsUploading(false)
      setProgress(null)
    },
    [uploadOne]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files)
    e.target.value = ''
  }

  return (
    <>
      <label
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`dropzone${isDragging ? ' drag' : ''}${isUploading ? ' busy' : ''}`}
      >
        <input
          type="file"
          multiple
          accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown"
          hidden
          onChange={onInputChange}
          disabled={isUploading}
        />
        <div className="up-ic">
          {isUploading ? (
            <span className="spin" style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: 'var(--cyan)' }} />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5" />
              <path d="M5 20h14" />
            </svg>
          )}
        </div>
        {isUploading ? (
          <div className="t">{progress ? `Uploading ${progress.done}/${progress.total}…` : 'Processing…'}</div>
        ) : (
          <>
            <div className="t">Drop files or <b>click to browse</b></div>
            <div className="h">PDF · TXT · MD — max 10 MB</div>
          </>
        )}
      </label>

      {status && (
        <p className={`upload-status ${status.type}`}>{status.message}</p>
      )}
    </>
  )
}
