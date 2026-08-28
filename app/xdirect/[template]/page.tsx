// app/xdirect/[template]/page.tsx
// One page per template (owner, Aug 27: "when user clicks a template, we
// should go to that template's dedicated page?").
//
// The setup forms used to open INSIDE the chat rail, which made them fight
// for width with the transcript — Music Video is the tallest and got
// compressed until its lower fields were unreachable — and left the start
// screen offering two entrances to the same send: a template card and a
// composer. A template is now a place you go, so the form gets the page, the
// URL is shareable, and the gallery has one job.
//
// `scratch` is the freeform road kept explicit: no template, no form, straight
// to the composer. It exists so the gallery can be the ONLY thing on the start
// screen without hiding the "just describe it" path.
//
// Rendering the same client keeps one implementation of the surface: this
// route only pre-answers "which template", exactly as the card click used to.

import { notFound } from 'next/navigation'
import XDirectClient from '../client'

// Slugs are skill directory names under skills/, plus the freeform road.
// Validated so a typo 404s instead of arming a template that doesn't exist
// and silently rendering the gallery-less start screen with nothing on it.
const TEMPLATES = new Set([
  'scratch',
  'music-video',
  'ai-animation',
  'story-to-video',
  'social-post',
  'product-video-pipeline',
])

export default async function XDirectTemplatePage({ params }: { params: Promise<{ template: string }> }) {
  const { template } = await params
  if (!TEMPLATES.has(template)) notFound()
  return <XDirectClient initialTemplate={template} />
}
