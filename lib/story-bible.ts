// lib/story-bible.ts — find the STORY BIBLE bubble in a conversation's
// transcript (shared by the print page and anything else that needs it).

/** The bible bubble: flagged by the chat since Aug 22, or recognised by its
 *  📖 header on older records. */
export function findBible(bubbles: unknown): { text: string; model?: string } | null {
  if (!Array.isArray(bubbles)) return null
  const b = bubbles.find((x: any) => x && x.role === 'agent' && (x.bible === true || /📖/.test(String(x.text ?? ''))))
  if (!b) return null
  const raw = String(b.text ?? '')
  // Strip the chat-only lines ("Here is the story I will direct from — <model>" / the correction hint).
  const lines = raw.split('\n')
  const head = lines[0] ?? ''
  const model = /—\s*(.+)$/.exec(head)?.[1]?.trim()
  const body = lines.filter(l => !/^Here is the story|^這是我要拍|^这是我要拍|^これが演出|^이것이 연출|^Wrong name|^名字錯了|^名字错了|^名前の誤り|^이름 오류/.test(l.trim())).join('\n').trim()
  // Bibles written before Aug 22 used single newlines between blocks, which
  // Markdown folds into one paragraph; give them the block structure the
  // current renderBible emits.
  const legacy = /\n(?=(?:Logline|Setting|Cast|Beats \(\d+\)|Left out):)/g
  const normalised = /\n\n/.test(body) ? body : body.replace(legacy, '\n\n').replace(/^(Logline|Setting|Left out):/gm, '**$1:**').replace(/^(Cast|Beats \(\d+\)):/gm, '**$1:**')
  return { text: normalised, model }
}
