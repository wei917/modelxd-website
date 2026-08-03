// app/terms/page.tsx — Terms of Service (drafted July 20, 2026; CC to review
// before beta. This is a plain static page; the big title lives in the
// TopBar per the July 16 convention.)

export const metadata = { title: 'Terms of Service — ModelXD' }

const S = {
  h2: { fontSize: 15, fontWeight: 800 as const, marginTop: 28, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  p:  { fontSize: 14, lineHeight: 1.75, color: 'var(--muted2)', marginBottom: 10 },
}

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px' }}>
      <div className="prompt-label eyebrow">Terms</div>
      <h1 className="page-headline" style={{ marginBottom: 16 }}>Terms of Service</h1>
      <p style={{ ...S.p, fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>
        Last updated: July 20, 2026
      </p>
      <p style={S.p}>
        Welcome to ModelXD. These Terms of Service (&quot;Terms&quot;) govern your use of the
        ModelXD website and services, including XDuel, XCreate, XVote, and XBoard
        (together, the &quot;Service&quot;). By creating an account or using the Service, you
        agree to these Terms.
      </p>

      <h2 style={S.h2}>1. What ModelXD Does</h2>
      <p style={S.p}>
        ModelXD lets you compare AI models side by side. XDuel runs your task on
        anonymous models and reveals identity and price after you vote. XCreate is a
        studio where you pick models and generate with your own credits. XVote lets the
        community compare and vote on completed duels. XBoard ranks models based on
        community votes. Model outputs are produced by third-party AI providers
        (such as OpenAI, Google, Alibaba, and others), not by ModelXD.
      </p>

      <h2 style={S.h2}>2. Accounts</h2>
      <p style={S.p}>
        You need an account (via Google sign-in) to create duels or use XCreate. You are
        responsible for activity under your account. You must be at least 13 years old
        (or the minimum age of digital consent in your country). We may suspend or
        terminate accounts that violate these Terms.
      </p>

      <h2 style={S.h2}>3. Free Quotas, Credits &amp; Payments</h2>
      <p style={S.p}>
        XDuel includes a limited number of free duels per day. XCreate usage is paid from your prepaid
        credit balance at the estimated provider rates shown before you generate; final
        cost is based on actual usage reported by the provider. Credits are prepaid,
        non-transferable, and — except where required by law — non-refundable. If a
        generation fails on our side, the corresponding quota or credits are refunded
        automatically. Prices, quotas, and discounts may change at any time.
      </p>

      <h2 style={S.h2}>4. Your Content</h2>
      <p style={S.p}>
        You keep ownership of the prompts and files you submit. By submitting them you
        grant ModelXD a license to process them (including sending them to the AI
        providers you are comparing) and to store the results. XDuel results are
        public: completed duels — including your prompt and the model outputs — appear
        in XVote and may be displayed across the Service. Your uploaded input files are
        visible only to you. XCreate runs and your votes are private to your account.
        Do not submit content you don&apos;t have the right to share.
      </p>

      <h2 style={S.h2}>5. Acceptable Use</h2>
      <p style={S.p}>
        You agree not to use the Service to create or distribute content that is
        illegal, infringing, sexually exploitative (especially involving minors),
        harassing, or intended to deceive; not to attempt to breach, overload, scrape,
        or reverse-engineer the Service; not to circumvent quotas, pricing, or safety
        systems; and to comply with the acceptable-use policies of the underlying AI
        providers. We may remove content or restrict accounts that break these rules.
      </p>

      <h2 style={S.h2}>6. AI Output Disclaimer</h2>
      <p style={S.p}>
        AI-generated outputs may be inaccurate, incomplete, biased, or unsuitable for
        your purpose. Outputs are provided for comparison and evaluation. You are
        responsible for reviewing outputs before relying on or publishing them. Model
        rankings on XBoard reflect community votes, not an objective measure of model
        quality, and may change.
      </p>

      <h2 style={S.h2}>7. Intellectual Property</h2>
      <p style={S.p}>
        The Service, including its design, code, and branding, belongs to ModelXD.
        Rights in AI outputs are subject to the terms of the provider that generated
        them; to the extent ModelXD holds any rights in outputs generated for you, we
        assign them to you, except for the public display rights described in Section 4.
      </p>

      <h2 style={S.h2}>8. Disclaimers &amp; Limitation of Liability</h2>
      <p style={S.p}>
        The Service is provided &quot;as is&quot; without warranties of any kind. Third-party
        providers may change, rate-limit, or discontinue models at any time. To the
        maximum extent permitted by law, ModelXD is not liable for indirect, incidental,
        or consequential damages, and our total liability for any claim is limited to
        the amount you paid us in the twelve months before the claim arose.
      </p>

      <h2 style={S.h2}>9. Changes &amp; Termination</h2>
      <p style={S.p}>
        We may update the Service or these Terms; material changes will be posted on
        this page with a new &quot;Last updated&quot; date. Continuing to use the Service after
        changes take effect means you accept them. You can stop using the Service or
        delete your account at any time.
      </p>

      <h2 style={S.h2}>10. Contact</h2>
      <p style={S.p}>
        Questions about these Terms or the Service:{' '}
        <a href="mailto:founder@modelxd.com" style={{ color: 'var(--red)' }}>founder@modelxd.com</a>.
      </p>
    </div>
  )
}
