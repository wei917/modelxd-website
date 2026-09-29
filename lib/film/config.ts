// lib/film/config.ts — the film type's choices and how its budget splits.
// Client-safe (no server imports): the composer shows these and the server
// enforces the same numbers.
//
// A film is Claude Opus 5.5 in a Managed Agents sandbox, directing and
// editing, with ModelXD's models for the pictures, clips and voice. See
// supabase/111_xcreate_films.sql and lib/film/driver.ts.

export const FILM_ASPECTS = ['9:16', '16:9', '1:1'] as const
export type FilmAspect = typeof FILM_ASPECTS[number]
export const isFilmAspect = (v: unknown): v is FilmAspect =>
  typeof v === 'string' && (FILM_ASPECTS as readonly string[]).includes(v)

export const FILM_LENGTHS = [15, 30, 60] as const
export const isFilmLength = (v: unknown): v is typeof FILM_LENGTHS[number] =>
  typeof v === 'number' && (FILM_LENGTHS as readonly number[]).includes(v)

/** Budgets on offer, in cents. $7 is the default (owner, Sep 29). */
export const FILM_BUDGETS = [500, 700, 1000, 1500] as const
export const FILM_DEFAULT_BUDGET = 700
export const isFilmBudget = (v: unknown): v is typeof FILM_BUDGETS[number] =>
  typeof v === 'number' && (FILM_BUDGETS as readonly number[]).includes(v)

export const FILM_BRIEF_MAX = 4000

/** A session still running after this long is stopped and settled with
 *  whatever it saved. The prototype's 30s film took 12 minutes. */
export const FILM_MAX_MINUTES = 45

/** How a budget splits. Claude's share becomes the session's budget, which
 *  the platform enforces before every model request; the generation share
 *  is enforced by our tool handler before every image, clip and line. The
 *  margin covers the one model request the platform lets finish past its
 *  cap, so the total can never pass what the viewer agreed to. Prototype,
 *  30s film: Claude $1.20, generation $3.07. */
export function filmSplit(budgetCents: number) {
  const marginCents = Math.max(40, Math.round(budgetCents * 0.06))
  const claudeCents = Math.round((budgetCents - marginCents) * 0.36)
  const genCents = budgetCents - marginCents - claudeCents
  return { claudeCents, genCents, marginCents }
}

export type FilmStatus = 'starting' | 'running' | 'finishing' | 'done' | 'failed'
export const isFilmActive = (s: FilmStatus) => s === 'starting' || s === 'running' || s === 'finishing'

/** One line of the progress view. `kind` says who wrote it. */
export type FilmProgress = { at: string; kind: 'note' | 'image' | 'clip' | 'voice' | 'step' | 'error'; text: string }

/** What GET /api/xcreate/film/[id] returns. */
export type FilmView = {
  id: string
  status: FilmStatus
  brief: string
  aspect: FilmAspect
  seconds: number
  budgetCents: number
  createdAt: string
  finishedAt: string | null
  progress: FilmProgress[]
  calls: { at: string; tool: string; name: string | null; status: string; costUsd: number | null }[]
  /** Spent so far: generation at list price plus Claude's list cost when known. */
  spentCents: number
  chargedCents: number | null
  videoUrl: string | null
  downloadUrl: string | null
  durationSeconds: number | null
  notes: string | null
  error: string | null
  xcreateId: string | null
}
