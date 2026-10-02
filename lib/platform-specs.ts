// lib/platform-specs.ts: what each platform's upload slot accepts, as numbers
// code can enforce when a result is downloaded (owner, Oct 1: "make
// photo/video taobao compliant, or make social platform compliant").
// Client-safe; the server half is lib/platform-export.ts.
//
// Sources, read Oct 1 2026 (summary in docs/STATE): official seller or help
// pages for Shopee TW, momo 商店, Rakuten RMS, Amazon.co.jp Seller Central,
// Instagram/Meta and LINE. Taobao's and 小紅書's own pages refused the fetch,
// so their numbers come from third-party guides, taking the stricter one.
//
// Only what code can guarantee lives here: exact pixels, JPEG, a file-size
// window, a background snapped to pure white. "No text", "no props" and
// the like are asked for in the template prompts and cannot be promised.

export type ExportSpecId =
  | 'taobao-main' | 'taobao-white' | 'shopee' | 'momo' | 'amazon' | 'rakuten'
  | 'social-34' | 'social-916' | 'line-rich'

export interface ExportSpec {
  id: ExportSpecId
  /** Exact output size. `side` makes it a square range instead: the image
   *  keeps its own size inside it (Amazon: zoom needs 1000, no upscaling). */
  w: number
  h: number
  side?: { min: number; max: number }
  maxBytes: number
  minBytes?: number
  /** The background must be pure white RGB 255: near-white pixels joined to
   *  the frame edge are snapped to 255, gaps are filled white, and the edge
   *  is checked. Without it a shape difference is cropped, never barred
   *  (蝦皮 and momo reject white or black edges, 楽天 any 枠線). */
  whiteBg?: boolean
  /** Download file name stem. */
  file: string
}

export const EXPORT_SPECS: ExportSpec[] = [
  // 淘寶/天貓 主圖 1:1: at least 800×800, 1440×1440 suggested, about 3 MB.
  { id: 'taobao-main',  w: 1440, h: 1440, maxBytes: 3_000_000, file: 'taobao-main' },
  // 淘寶 白底圖: 800×800, pure white, JPG, more than 38 KB and at most 300 KB.
  { id: 'taobao-white', w: 800, h: 800, minBytes: 38_000, maxBytes: 300_000, whiteBg: true, file: 'taobao-white' },
  // 蝦皮: square, edge to edge, at least 500×500, under 2 MB (official).
  { id: 'shopee',       w: 1024, h: 1024, maxBytes: 2_000_000, file: 'shopee' },
  // momo 商品主圖: 1000×1000, 50 KB to 1000 KB, YCbCr JPEG (official).
  { id: 'momo',         w: 1000, h: 1000, minBytes: 50_000, maxBytes: 1_000_000, file: 'momo' },
  // Amazon.co.jp MAIN: pure white RGB 255; longest side 1000+ for zoom (official).
  { id: 'amazon',       w: 1000, h: 1000, side: { min: 1000, max: 2000 }, maxBytes: 10_000_000, whiteBg: true, file: 'amazon-main' },
  // 楽天 第1商品画像: square, 700×700 or more; R-Cabinet keeps 2 MB or less.
  { id: 'rakuten',      w: 1000, h: 1000, maxBytes: 2_000_000, file: 'rakuten' },
  // Instagram feed shows up to 3:4 uncropped (official); 小紅書 3:4 1080×1440.
  { id: 'social-34',    w: 1080, h: 1440, maxBytes: 8_000_000, file: 'post-3x4' },
  // Stories, Reels, TikTok and Shorts covers: 9:16, 1080×1920.
  { id: 'social-916',   w: 1080, h: 1920, maxBytes: 8_000_000, file: 'story-9x16' },
  // LINE 圖文訊息 / リッチメッセージ: 1040×1040, 10 MB or less (official).
  { id: 'line-rich',    w: 1040, h: 1040, maxBytes: 10_000_000, file: 'line-1040' },
]

export const exportSpecById = (id: string | null | undefined): ExportSpec | null =>
  EXPORT_SPECS.find(s => s.id === id) ?? null

/** One line of the checklist shown after a download. */
export interface ExportCheck {
  key: 'size' | 'format' | 'bytes' | 'white'
  ok: boolean
  value: string
}

/** The spec a result's download offers first, by page language: the
 *  marketplaces each market actually sells on. */
export const DEFAULT_EXPORT_BY_LANG: Record<string, ExportSpecId> = {
  'zh-Hant': 'shopee', ja: 'rakuten', 'zh-Hans': 'taobao-main', en: 'amazon', ko: 'amazon',
}
