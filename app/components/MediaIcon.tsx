// app/components/MediaIcon.tsx
// The approved ModelXD media icons (owner, Oct 17, via Codex's handoff:
// ~/Documents/ModelXD_ChatGPT/output/modelxd-approved-media-icons-20261017,
// HANDOFF.txt and manifest.json). One mapping for every media-type
// navigation: XDuel's top bar and XCreate's type bar.
//
// Full colour in every state, active or not: never tinted with filters or
// currentColor, never redrawn. The files in public/media-icons are the set's
// own 128 px PNG exports (transparent, square), sharp up to 42 CSS px on a
// 3x screen. The consumer sizes the box; the art is contained in it. They
// always sit beside a visible label, so the alt text is empty.

//
// Speech and music (Oct 22, when 音訊 became 語音 and 音樂 tabs; owner: "so we
// need one or two new icons"): a microphone with sound waves and a record
// with music notes, drawn by GPT Image with the approved set as the style
// reference, cut out and sized to the set (scratchpad icons/cut.cjs). The
// headphones stay for XBoard's 音訊, which keeps both boards in one tab.

export type MediaKind = 'text' | 'image' | 'video' | 'audio' | 'speech' | 'music' | 'game'

export const MEDIA_ICON_SRC: Record<MediaKind, string> = {
  text:   '/media-icons/text.png',
  image:  '/media-icons/image.png',
  video:  '/media-icons/video.png',
  audio:  '/media-icons/audio.png',
  speech: '/media-icons/speech.png',
  music:  '/media-icons/music.png',
  game:   '/media-icons/game.png',
}

/** Whether the approved set has an icon for this kind (XCreate's Film has none). */
export function hasMediaIcon(kind: string): kind is MediaKind {
  return kind in MEDIA_ICON_SRC
}

export default function MediaIcon({ kind, className }: { kind: MediaKind; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={MEDIA_ICON_SRC[kind]}
      alt=""
      width={128}
      height={128}
      decoding="async"
      draggable={false}
      className={className ? `media-icon ${className}` : 'media-icon'}
    />
  )
}
