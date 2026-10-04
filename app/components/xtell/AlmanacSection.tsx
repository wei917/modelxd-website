// app/components/xtell/AlmanacSection.tsx — the street's 黃曆 section, as a
// section of its own (owner, Sep 28). A server component: it computes the
// visitor's day on the server (lib/xtell-almanac-server.ts) and hands the
// card its data, so the browser never loads the calendar library. The page
// renders it inside its own Suspense and error boundary (`almanacSection`),
// so it never holds up, or takes down, the rest of the street.

import { headers } from 'next/headers'
import { Suspense } from 'react'
import { AlmanacCard } from './XTellToday'
import SectionBoundary from './SectionBoundary'
import { almanacForZone } from '../../../lib/xtell-almanac-server'
import { serverLang } from '../../../lib/lang'
import { siteFromHeaders } from '../../../lib/site'

async function Almanac({ compact }: { compact: boolean }) {
  const h = await headers()
  return <AlmanacCard compact={compact} initial={almanacForZone(h.get('x-vercel-ip-timezone'), serverLang(h, siteFromHeaders(h)))} />
}

/** The section as the street places it. Without the server's day (loading,
 *  or a failure), the card asks /api/xtell/almanac for the phone's own day.
 *  The homepage's card row shows it compact (Oct 3), the details a press away. */
export function almanacSection({ compact = true }: { compact?: boolean } = {}) {
  return (
    <SectionBoundary fallback={<AlmanacCard compact={compact} />}>
      <Suspense fallback={<AlmanacCard compact={compact} />}>
        <Almanac compact={compact} />
      </Suspense>
    </SectionBoundary>
  )
}
