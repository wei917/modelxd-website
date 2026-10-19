'use client'
// /xduel/<id> — one saved duel, on the same five-step page as a new one
// (owner, Oct 18: the duel's id in the address, so a reload or a shared
// link carries on the same duel). Its maker continues where they left off;
// someone else votes on it blind, then with the prices; a signed-out
// visitor sees it. It was a page of its own, with its own older layout.
import { useParams } from 'next/navigation'
import XDuelPage from '../XDuelPage'

export default function DuelPermalink() {
  const { id } = useParams<{ id: string }>()
  return <XDuelPage key={id} resumeId={id} />
}
