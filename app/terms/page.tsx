import LocaleSummary from '../components/LocaleSummary'
import { XCreateLegalNote } from '../components/xcreate/XCreateNav'
// app/terms/page.tsx — Terms of Service (drafted July 20, 2026; CC to review
// before beta. This is a plain static page; the big title lives in the
// TopBar per the July 16 convention.) Sep 28: every door and app named,
// XTell's entertainment-only rule, other people's details, and the referral
// rules; Your Content moved to §5.

export const metadata = { title: 'Terms of Service — ModelXD' }

const S = {
  h2: { fontSize: 15, fontWeight: 800 as const, marginTop: 28, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  p:  { fontSize: 14, lineHeight: 1.75, color: 'var(--muted2)', marginBottom: 10 },
}

export default function TermsPage() {
  return (
    <main id="xtell-main" tabIndex={-1} style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px', outline: 'none' }}>
      <div className="prompt-label eyebrow">Terms</div>
      <h1 className="page-headline" style={{ marginBottom: 16 }}>Terms of Service</h1>
      <XCreateLegalNote />
      <p style={{ ...S.p, fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>
        Last updated: September 29, 2026
      </p>
      <p style={S.p}>
        Welcome to ModelXD. These Terms of Service (&quot;Terms&quot;) govern your use of
        ModelXD&apos;s websites (modelxd.com, xtell.modelxd.com and xcreate.modelxd.com)
        and services, including XDuel, XCreate, XDirect, XCut, XTalk, XGame, XWorld,
        XArch, XTell (X先知), XVote, XBoard and the API (together, the
        &quot;Service&quot;). By creating an account or using the Service, you agree to
        these Terms.
      </p>

      <LocaleSummary items={['legal.terms.content', 'legal.terms.public', 'legal.terms.credits', 'legal.terms.plan', 'legal.terms.refund', 'legal.terms.referral', 'legal.terms.xtell']} />
      <h2 style={S.h2}>1. What ModelXD Does</h2>
      <p style={S.p}>
        ModelXD runs apps built on many AI models: a studio for images and video
        (XCreate, XDirect, XCut), rooms and games (XTalk, XGame), 3D worlds and floor
        plans (XWorld, XArch), fortune-telling temples (XTell, also called X先知), and
        an API for developers. XDuel runs your task on anonymous models and reveals
        identity and price after you vote; XVote lets the community vote on completed
        duels; XBoard ranks models on those votes. Model outputs are produced by
        third-party AI providers (such as OpenAI, Google, Alibaba, Anthropic, and
        others), not by ModelXD.
      </p>

      <h2 style={S.h2}>2. Accounts</h2>
      <p style={S.p}>
        Most of the Service needs an account (via Google, LINE or X sign-in); a few parts, such
        as the XTell almanac, work without one. You are responsible for activity under
        your account. You must be at least 13 years old (or the minimum age of digital
        consent in your country). We may suspend or terminate accounts that violate
        these Terms.
      </p>

      <h2 style={S.h2}>3. Free Quotas, Credits &amp; Payments</h2>
      <p style={S.p}>
        Some features are free: XDuel includes a limited number of free duels per day,
        and XTell&apos;s charts and daily reading cost nothing. Other use, including
        asking an XTell teacher, is paid from your prepaid credit balance at the
        estimated rates shown before you run it; final cost is based on actual usage
        reported by the provider. Credits are prepaid, non-transferable, and, except
        where required by law, non-refundable. The monthly plan renews automatically
        every month until you cancel it; cancelling stops the next renewal, and the
        plan stays active until the end of the month already paid for. Each
        month&apos;s plan credit is used before any other credit and expires at the
        end of that month; it does not roll over. Credit bought separately as a top-up
        does not expire. If a generation fails on our side, the corresponding quota or
        credits are refunded automatically. Prices, quotas, and discounts may change
        at any time.
      </p>

      <h2 style={S.h2}>4. Welcome &amp; Referral Credit</h2>
      <p style={S.p}>
        New accounts may receive welcome credit. If someone you invite with your
        referral link signs up and verifies a payment card (Stripe checks the card and
        does not charge it), you and they each receive the referral credit shown on
        your account page. Each card counts once, whichever account uses it. Welcome
        and referral credit has no cash value and cannot be transferred. We may
        withhold or reverse credit obtained through fake or duplicate accounts,
        referring yourself, or other abuse. Amounts may change for referrals made
        after the change.
      </p>

      <h2 style={S.h2}>5. Your Content</h2>
      <p style={S.p}>
        You keep ownership of the prompts and files you submit. By submitting them you
        grant ModelXD a license to process them (including sending them to the AI
        providers that run your task) and to store the results. XDuel results are
        public: completed duels, including your prompt, anything attached to it, and
        the model outputs, appear in XVote and may be displayed across the Service.
        Everything else you submit is private to your account. Do not submit content
        you don&apos;t have the right to share. If you enter details about another
        person (for example a partner&apos;s birth details at 月老 or someone&apos;s
        name at 姓名學), you confirm that you are allowed to share them with us for
        that purpose.
      </p>

      <h2 style={S.h2}>6. Acceptable Use</h2>
      <p style={S.p}>
        You agree not to use the Service to create or distribute content that is
        illegal, infringing, sexually exploitative (especially involving minors),
        harassing, or intended to deceive; not to attempt to breach, overload, scrape,
        or reverse-engineer the Service; not to circumvent quotas, pricing, or safety
        systems; and to comply with the acceptable-use policies of the underlying AI
        providers. We may remove content or restrict accounts that break these rules.
      </p>

      <h2 style={S.h2}>7. AI Output Disclaimer</h2>
      <p style={S.p}>
        AI-generated outputs may be inaccurate, incomplete, biased, or unsuitable for
        your purpose. You are responsible for reviewing outputs before relying on or
        publishing them. Model rankings on XBoard reflect community votes, not an
        objective measure of model quality, and may change.
      </p>
      <p style={S.p}>
        XTell (X先知) is for reflection and entertainment. Its readings are AI
        interpretations of charts, sticks and texts computed from traditional
        methods; they are not statements of fact and not professional advice. Do not
        rely on them for decisions about health, money, legal matters or safety; for
        those, consult a qualified professional.
      </p>

      <h2 style={S.h2}>8. Intellectual Property</h2>
      <p style={S.p}>
        The Service, including its design, code, and branding, belongs to ModelXD.
        Rights in AI outputs are subject to the terms of the provider that generated
        them; to the extent ModelXD holds any rights in outputs generated for you, we
        assign them to you, except for the public display rights described in Section 5.
      </p>

      <h2 style={S.h2}>9. Disclaimers &amp; Limitation of Liability</h2>
      <p style={S.p}>
        The Service is provided &quot;as is&quot; without warranties of any kind. Third-party
        providers may change, rate-limit, or discontinue models at any time. To the
        maximum extent permitted by law, ModelXD is not liable for indirect, incidental,
        or consequential damages, and our total liability for any claim is limited to
        the amount you paid us in the twelve months before the claim arose.
      </p>

      <h2 style={S.h2}>10. Changes &amp; Termination</h2>
      <p style={S.p}>
        We may update the Service or these Terms; material changes will be posted on
        this page with a new &quot;Last updated&quot; date. Continuing to use the Service after
        changes take effect means you accept them. You can stop using the Service or
        delete your account at any time.
      </p>

      <h2 style={S.h2}>11. Contact</h2>
      <p style={S.p}>
        Questions about these Terms or the Service:{' '}
        <a href="mailto:support@modelxd.com" style={{ color: 'var(--red)' }}>support@modelxd.com</a>.
      </p>
    </main>
  )
}
