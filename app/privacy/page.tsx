// app/privacy/page.tsx — Privacy Policy (drafted July 20, 2026; CC to review
// before beta). Static page, same layout language as /terms.

export const metadata = { title: 'Privacy Policy — ModelXD' }

const S = {
  h2: { fontSize: 15, fontWeight: 800 as const, marginTop: 28, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  p:  { fontSize: 14, lineHeight: 1.75, color: 'var(--muted2)', marginBottom: 10 },
}

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px' }}>
      <div className="prompt-label eyebrow">Privacy</div>
      <h1 className="page-headline" style={{ marginBottom: 16 }}>Privacy Policy</h1>
      <p style={{ ...S.p, fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>
        Last updated: July 20, 2026
      </p>
      <p style={S.p}>
        This policy explains what data ModelXD collects, how it is used, and the
        choices you have. It applies to modelxd.com and all ModelXD services
        (XDuel, XCreate, XVote, XBoard).
      </p>

      <h2 style={S.h2}>1. What We Collect</h2>
      <p style={S.p}>
        <strong>Account data.</strong> When you sign in with Google we receive your
        name, email address, and profile picture. We also store your language and
        country (from your browser and network region) to localize the product.
        <br /><strong>Content you submit.</strong> Prompts, uploaded files (images,
        videos, documents), the AI outputs generated for you, and your votes.
        <br /><strong>Payments.</strong> Purchases are processed by Stripe. We store
        your credit balance and transaction history; your card details never touch
        our servers.
        <br /><strong>Technical data.</strong> Standard server logs (IP address,
        browser type, timestamps) and per-request metadata about AI provider calls
        (tokens used, latency, cost) for billing and abuse prevention.
      </p>

      <h2 style={S.h2}>2. How We Use It</h2>
      <p style={S.p}>
        To run the Service: sending your prompts and files to the AI providers you
        are comparing (OpenAI, Google, Alibaba, xAI, Anthropic, and others),
        generating and storing results, computing community rankings, managing
        quotas and credits, and keeping the Service safe. We do not sell your
        personal data, and we do not use your content to train our own models.
        Providers process your content under their own API terms; we send them only
        what a generation needs (the prompt and attached files), never your name or
        email.
      </p>

      <h2 style={S.h2}>3. What Is Public</h2>
      <p style={S.p}>
        Completed XDuels — the prompt and the models&apos; outputs — are public and
        appear in XVote. Your identity is never attached to public duels. Your
        uploaded input files, XCreate runs, votes, and credit history are private
        to your account.
      </p>

      <h2 style={S.h2}>4. Cookies</h2>
      <p style={S.p}>
        We use only essential cookies: your sign-in session and, on gated preview
        domains, a site-access token. No advertising or cross-site tracking
        cookies.
      </p>

      <h2 style={S.h2}>5. Retention &amp; Deletion</h2>
      <p style={S.p}>
        Your data is kept while your account is active. You can delete individual
        XDuels and XCreates at any time from your profile, or delete your entire
        account under Profile → Danger Zone — this permanently removes your
        account, content, uploaded files, and history. Aggregated, anonymous
        statistics (such as model vote totals) may be retained. You can also email{' '}
        <a href="mailto:founder@modelxd.com" style={{ color: 'var(--red)' }}>founder@modelxd.com</a>{' '}
        to request deletion or a copy of your data.
      </p>

      <h2 style={S.h2}>6. Sharing</h2>
      <p style={S.p}>
        We share data only with the processors needed to run the Service: AI
        providers (your prompts/files, for generation), Stripe (payments), Supabase
        (database, storage, and authentication hosting), and Vercel (web hosting).
        We may disclose data if required by law.
      </p>

      <h2 style={S.h2}>7. Children</h2>
      <p style={S.p}>
        ModelXD is not directed at children under 13 (or the applicable minimum age
        of digital consent), and we do not knowingly collect their data.
      </p>

      <h2 style={S.h2}>8. Changes &amp; Contact</h2>
      <p style={S.p}>
        We will post any material changes here with a new &quot;Last updated&quot; date.
        Questions:{' '}
        <a href="mailto:founder@modelxd.com" style={{ color: 'var(--red)' }}>founder@modelxd.com</a>.
      </p>
    </div>
  )
}
