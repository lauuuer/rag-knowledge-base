/**
 * Extracts plain text from a PDF buffer.
 * Uses pdf-parse under the hood.
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // Dynamic import — pdf-parse has side effects on load
  const pdfParse = (await import('pdf-parse')).default
  const result = await pdfParse(buffer)
  return result.text
}
