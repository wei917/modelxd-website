// app/xdirector/page.tsx
// XDirector as a marketable destination (CC, July 27): a real page with its
// own metadata for campaign links and SEO. The same XDirectorChat component
// also powers Agent Mode inside /xcreate — two entrances, one implementation.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasFeature } from '@/lib/features'
import XDirectorClient from './client'

export const metadata: Metadata = {
  title: 'XDirector — Your Personal AI Video Director | ModelXD',
  description: 'Tell XDirector what you want. It picks the best-value AI model with real prices, writes the prompt, and generates your video — all in one conversation. Same result, pay less.',
  openGraph: {
    title: 'XDirector — Your Personal AI Video Director',
    description: 'A director that knows what every AI video model costs. Same result, pay less.',
  },
}

export default async function XDirectorPage() {
  // Limited beta. 404 rather than 403 so the page's existence isn't
  // advertised to people who can't use it yet.
  if (!(await hasFeature('xdirector'))) notFound()
  return <XDirectorClient />
}
