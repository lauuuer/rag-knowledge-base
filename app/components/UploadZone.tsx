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
          multiple
          accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown"
          className="hidden"
          onChange={onInputChange}
          disabled={isUploading}
        />
        <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {isUploading ? (
          <p className="text-sm text-indigo-600 font-medium">
            {progress ? `Uploading ${progress.done}/${progress.total}…` : 'Processing…'}
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-600">Drop files or <span className="text-indigo-600 font-medium">click to browse</span></p>
            <p className="text-xs text-gray-400 mt-1">PDF, TXT or MD · max 10 MB · up to {MAX_FILES} files</p>
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
