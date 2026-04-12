// lib/credits.ts
//
// Typed helpers for the credit wallet system. Everything in this module is
// server-only — it uses the Supabase service-role key to call the
// grant_credits / debit_credits RPCs defined in supabase/11_credits.sql.
//
// Client-side code should read user_credits / credit_transactions directly
// via the authenticated Supabase browser client. The owner-read RLS
// policies in the migration guarantee users only see their own rows.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────

// Matches the CHECK constraint on credit_transactions.kind.
export type CreditKind = 'grant' | 'purchase' | 'debit' | 'refund' | 'adjustment'

// Kinds that add to the balance (grant_credits accepts these).
export type CreditGrantKind = Exclude<CreditKind, 'debit'>

// Kinds that subtract from the balance (debit_credits accepts these).
export type CreditDebitKind = Extract<CreditKind, 'debit' | 'adjustment'>

export interface UserCredits {
  user_id: string
  balance_cents: number
  lifetime_granted_cents: number
  lifetime_spent_cents: number
  updated_at: string
}

export interface CreditTransaction {
  id: string
  user_id: string
  kind: CreditKind
  /** Signed: grants/purchases/refunds positive, debits negative. */
  amount_cents: number
  balance_after_cents: number
  reference_type: string | null
  reference_id: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

// ── Service client ────────────────────────────────────────────────────────

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error('lib/credits: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Errors ────────────────────────────────────────────────────────────────

/**
 * Raised when a debit would drive the user's balance negative. Callers
 * should catch this and surface the "top up your balance" UI flow instead
 * of showing a generic 500.
 */
export class InsufficientCreditsError extends Error {
  constructor(message = 'insufficient_credits') {
    super(message)
    this.name = 'InsufficientCreditsError'
  }
}

// ── grantCredits ──────────────────────────────────────────────────────────

export interface GrantOptions {
  userId: string
  amountCents: number
  kind?: CreditGrantKind
  referenceType?: string
  referenceId?: string
  description?: string
  metadata?: Record<string, unknown>
}

/**
 * Adds credits to a user's balance and appends a ledger row atomically via
 * the grant_credits RPC. Returns the new balance in cents.
 */
export async function grantCredits(opts: GrantOptions): Promise<number> {
  if (!Number.isInteger(opts.amountCents) || opts.amountCents <= 0) {
    throw new Error('grantCredits: amountCents must be a positive integer')
  }
  const sb = serviceClient()
  const { data, error } = await sb.rpc('grant_credits', {
    p_user_id:        opts.userId,
    p_amount_cents:   opts.amountCents,
    p_kind:           opts.kind ?? 'grant',
    p_reference_type: opts.referenceType ?? null,
    p_reference_id:   opts.referenceId ?? null,
    p_description:    opts.description ?? null,
    p_metadata:       opts.metadata ?? null,
  })
  if (error) throw new Error(`grantCredits failed: ${error.message}`)
  return Number(data)
}

// ── debitCredits ──────────────────────────────────────────────────────────

export interface DebitOptions {
  userId: string
  amountCents: number
  kind?: CreditDebitKind
  referenceType?: string
  referenceId?: string
  description?: string
  metadata?: Record<string, unknown>
}

/**
 * Subtracts credits from a user's balance and appends a ledger row
 * atomically via the debit_credits RPC. Returns the new balance in cents.
 *
 * Throws InsufficientCreditsError when the balance would go negative.
 */
export async function debitCredits(opts: DebitOptions): Promise<number> {
  if (!Number.isInteger(opts.amountCents) || opts.amountCents <= 0) {
    throw new Error('debitCredits: amountCents must be a positive integer')
  }
  const sb = serviceClient()
  const { data, error } = await sb.rpc('debit_credits', {
    p_user_id:        opts.userId,
    p_amount_cents:   opts.amountCents,
    p_kind:           opts.kind ?? 'debit',
    p_reference_type: opts.referenceType ?? null,
    p_reference_id:   opts.referenceId ?? null,
    p_description:    opts.description ?? null,
    p_metadata:       opts.metadata ?? null,
  })
  if (error) {
    if (error.message?.includes('insufficient_credits')) {
      throw new InsufficientCreditsError(error.message)
    }
    throw new Error(`debitCredits failed: ${error.message}`)
  }
  return Number(data)
}

// ── Read helpers (server-side) ────────────────────────────────────────────

/**
 * Fetch a user's wallet row. Server-side only; client code should use the
 * authenticated Supabase browser client and rely on RLS instead.
 */
export async function getUserCredits(userId: string): Promise<UserCredits | null> {
  const sb = serviceClient()
  const { data, error } = await sb
    .from('user_credits')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`getUserCredits failed: ${error.message}`)
  return (data as UserCredits | null) ?? null
}

/**
 * Fetch a user's most recent ledger entries. Server-side only.
 */
export async function getCreditTransactions(
  userId: string,
  limit = 50,
): Promise<CreditTransaction[]> {
  const sb = serviceClient()
  const { data, error } = await sb
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`getCreditTransactions failed: ${error.message}`)
  return (data ?? []) as CreditTransaction[]
}

// ── Formatting helper ─────────────────────────────────────────────────────

/**
 * Format an integer cent amount as a human-readable dollar string.
 * Handles sub-dollar values with extra precision so tiny debits don't
 * render as "$0.00" in the ledger.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  if (abs === 0) return '$0.00'
  if (abs < 100) return `${sign}$${(abs / 100).toFixed(2)}`
  return `${sign}$${(abs / 100).toFixed(2)}`
}
