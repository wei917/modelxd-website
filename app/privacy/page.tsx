import LocaleSummary from '../components/LocaleSummary'
import { XCreateLegalNote } from '../components/xcreate/XCreateNav'
// app/privacy/page.tsx — Privacy Policy (drafted July 20, 2026; CC to review
// before beta). Static page, same layout language as /terms. Sep 28: XTell's
// data, the referral card check, bug reports, the language and referral
// cookies, and what deleting really erases (XTell rows at once; a removed
// XDuel/XCreate only hides until the account goes).

export const metadata = { title: 'Privacy Policy — ModelXD' }

const S = {
  h2: { fontSize: 15, fontWeight: 800 as const, marginTop: 28, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  p:  { fontSize: 14, lineHeight: 1.75, color: 'var(--muted2)', marginBottom: 10 },
}

export default function PrivacyPage() {
  return (
    <main id="xtell-main" tabIndex={-1} style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px', outline: 'none' }}>
      <div className="prompt-label eyebrow">Privacy</div>
      <h1 className="page-headline" style={{ marginBottom: 16 }}>Privacy Policy</h1>
      <XCreateLegalNote />
      <p style={{ ...S.p, fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>
        Last updated: September 28, 2026
      </p>
      <p style={S.p}>
        This policy explains what data ModelXD collects, how it is used, and the
        choices you have. It applies to modelxd.com, xtell.modelxd.com (X先知),
        xcreate.modelxd.com and every ModelXD service, including XDuel, XCreate,
        XDirect, XCut, XTalk, XGame, XWorld, XArch, XTell, XVote, XBoard and the API.
      </p>

      <LocaleSummary items={['legal.privacy.public', 'legal.privacy.private', 'legal.privacy.xtell', 'legal.privacy.use', 'legal.privacy.cookies', 'legal.privacy.delete']} />
      <h2 style={S.h2}>1. What We Collect</h2>
      <p style={S.p}>
        <strong>Account data.</strong> When you sign in with Google we receive your
        name, email address, and profile picture. We also store your language and
        country (from your browser and network region) to localize the product.
        <br /><strong>Content you submit.</strong> Prompts, messages, uploaded files
        (images, videos, documents), the AI outputs generated for you, and your votes.
        <br /><strong>XTell (X先知).</strong> What a temple needs to draw your chart
        or answer you: your birth date and time (or that the hour is unknown) and the
        time zone you were born in; for 月老 and compatibility charts, the same for a
        second person; a name at 姓名學, a character at 測字, your wishes at 四面佛, or
        a dream at 解夢; and your questions and readings. If you choose to save your
        birth details for the free daily reading (今日運勢), we keep them, with the
        time zone you read in, until you delete them.
        <br /><strong>Payments.</strong> Purchases are processed by Stripe. We store
        your credit balance and transaction history; your card details never touch
        our servers. When you verify a card for a referral, Stripe checks it without
        charging it and gives us its fingerprint: a code that is the same for the
        same card on any account. We keep that code so each card earns a referral
        only once.
        <br /><strong>Bug reports.</strong> What you write, the page you were on, your
        browser and screen size, your email if you are signed in, and any screenshot
        you attach.
        <br /><strong>Technical data.</strong> Standard server logs (IP address,
        browser type, timestamps) and per-request metadata about AI provider calls
        (tokens used, latency, cost) for billing and abuse prevention.
      </p>

      <h2 style={S.h2}>2. How We Use It</h2>
      <p style={S.p}>
        To run the Service: sending your prompts and files to the AI models that
        run your task (from OpenAI, Google, Alibaba, xAI, Anthropic, Moonshot,
        MiniMax, Runway, World Labs, Tripo and others), generating and storing
        results, computing community rankings, managing quotas and credits, and
        keeping the Service safe.
      </p>
      <p style={S.p}>
        In XTell, charts, sticks and the almanac are computed by our own code. When
        you ask a teacher, the details the reading needs (such as your birth details,
        the chart computed from them, a name at 姓名學 or your dream) and your
        question go to the model you chose. The free helpers (the guide on the
        street, the daily reading and the dream lookup) run on models we choose from
        the same providers.
      </p>
      <p style={S.p}>
        We do not sell your personal data, and we do not use your content to train
        our own models. Providers process your content under their own API terms; we
        send them only what the task needs, never your account name or email.
      </p>

      <h2 style={S.h2}>3. What Is Public</h2>
      <p style={S.p}>
        Completed XDuels are public and appear in XVote, including the prompt,
        anything attached to it, and the models&apos; outputs. Your name, email and
        profile are never shown with a duel. Everything else is private to your
        account: your work in XCreate, XDirect, XCut, XTalk, XGame, XWorld, XArch and
        XTell, your votes, your profile, and your credit history. Nothing in XTell is
        public: your readings, questions and birth details are visible only to you.
      </p>

      <h2 style={S.h2}>4. Cookies</h2>
      <p style={S.p}>
        We use essential cookies: your sign-in session, your language
        (modelxd_lang), a referral code while you sign up through someone&apos;s
        referral link (modelxd_ref, 30 days), and, on gated preview domains, a
        site-access token. We also use the Google Ads tag
        (gtag.js) on our production sites to measure whether our ads bring
        visitors. It sends Google the page you visit and technical details of
        your browser, and it can set Google advertising cookies. In the
        European Economic Area, the United Kingdom and Switzerland those
        advertising and analytics cookies are off by default. Nothing you type
        (prompts, questions, birth details, readings) is sent to Google Ads,
        and we do not sell your data. You can limit Google ad personalization
        at adssettings.google.com.
      </p>
      <p style={S.p}>
        We also keep our own visit log: the pages you open, how long the tab is
        in front, the ad or link that brought you (Google&apos;s click ID,
        campaign tags and the referring site), your country and city as seen
        from your connection, and your device type. A first-party cookie
        (modelxd_vid, one year) connects visits from the same browser, and a
        visit is linked to your account while you are signed in. We do not
        store your IP address. The visit log and its cookie are off in the
        European Economic Area, the United Kingdom and Switzerland.
      </p>

      <h2 style={S.h2}>5. Retention &amp; Deletion</h2>
      <p style={S.p}>
        Your data is kept while your account is active. XTell readings you delete on
        your account page are erased at once, and so are saved birth details when
        you delete them there. Removing an XDuel or XCreate from your profile hides it
        everywhere, including XVote; the stored copy is erased when you delete your
        account. You can delete your entire account under Profile → Danger Zone,
        which permanently removes your account, content, uploaded files, and
        history. Aggregated, anonymous statistics (such as model vote totals) may be
        retained, and bug reports are kept until you ask us to erase them. You can
        email{' '}
        <a href="mailto:support@modelxd.com" style={{ color: 'var(--red)' }}>support@modelxd.com</a>{' '}
        to request deletion or a copy of your data.
      </p>

      <h2 style={S.h2}>6. Sharing</h2>
      <p style={S.p}>
        We share data only with the processors needed to run the Service: AI
        providers (what a task needs, for generation), Stripe (payments and card
        checks), Supabase (database, storage, and authentication hosting), Vercel
        (web hosting) and Google (the ads tag described above).
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
        <a href="mailto:support@modelxd.com" style={{ color: 'var(--red)' }}>support@modelxd.com</a>.
      </p>
    </main>
  )
}
