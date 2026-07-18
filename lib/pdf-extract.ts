// lib/pdf-extract.ts
//
// Serverless-friendly PDF → text extraction, used as the fallback path for
// models that don't natively ingest PDFs (see lib/providers/index.ts). Built
// on `unpdf` (bundles a pdf.js build with no native deps, runs on Vercel's
// Node runtime).
//
// This only pulls the embedded *text* layer — it does not OCR scanned
// images. For scanned/image-only PDFs the result will be empty or sparse;
// such documents are better served by a natively-PDF-capable model
// (tick "PDF → Text" on that model in /admin/models).

const MAX_CHARS = 200_000 // ~50k tokens — guardrail against pathological PDFs

export async function extractPdfText(buffer: Buffer): Promise<string> {
  // Lazy import so the pdf.js bundle never loads on requests without a PDF.
  const { getDocumentProxy, extractText } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  const merged = (Array.isArray(text) ? text.join('\n\n') : text).trim()
  return merged.length > MAX_CHARS ? merged.slice(0, MAX_CHARS) + '\n\n[…truncated]' : merged
}
