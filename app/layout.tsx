import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RAG Knowledge Base',
  description: 'Upload documents and ask questions with cited answers',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {/* Ambient backdrop — shared across every screen */}
        <div className="ambient" aria-hidden="true">
          <div className="orb cyan" />
          <div className="orb violet" />
          <div className="orb mid" />
        </div>
        <div className="gridlines" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />

        <div className="app-root">{children}</div>
      </body>
    </html>
  )
}
