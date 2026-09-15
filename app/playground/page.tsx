import type { Metadata } from 'next'
import PlaygroundClient from './client'

// Public: no sign-in, no model call, no credits. The page shows pictures and
// prompts; its actions open XDuel / XDirect with a prompt filled in, and
// nothing runs until the visitor presses start there.
export const metadata: Metadata = {
  title: 'ModelXD Playground — AIで遊ぶ。つくる。比べる。',
  description: 'Play, make and compare with AI. Open a work, rewrite its prompt, and send it to an image duel or a film. Unofficial fan concepts of famous games plus scenario presets; nothing runs until you press start.',
}

export default function PlaygroundPage() {
  return <PlaygroundClient />
}
