// /xdev/docs → /xdev#docs. The reference merged into the developer page
// (owner, Sep 1: one page); this redirect keeps every link already in the
// wild working — the game guideline, the site agent's answers, customer
// chats. 308: the move is permanent.
import { NextResponse } from 'next/server'

export function GET(req: Request) {
  const url = new URL('/xdev#docs', new URL(req.url).origin)
  return NextResponse.redirect(url, 308)
}
