import { XCreateLegalNote } from '../components/xcreate/XCreateNav'
// app/tokushoho/page.tsx — 特定商取引法に基づく表記 (Sep 29): the seller
// disclosure Japan expects for paid online services (credits and the ¥749
// plan). The seller is ModelXD LLC; the responsible person and phone are
// disclosed on request, by email (owner, Sep 29: the owner is not named
// publicly; docs/TOKUSHOHO-DRAFT.md has the reading of 第11条 ただし書 this
// relies on, still to be confirmed by a professional). Served on every
// door (lib/site.ts) and linked from each footer beside Terms and Privacy.
// The Japanese text is the one that applies.

export const metadata = { title: '特定商取引法に基づく表記 — ModelXD' }

const ON_REQUEST = '請求があった場合には、遅滞なく電子メールにて開示いたします。'

const ROWS: Array<[string, React.ReactNode]> = [
  ['販売業者', 'ModelXD LLC'],
  ['運営統括責任者', ON_REQUEST],
  ['所在地', '5830 E 2nd St, Ste 7000 #33449, Casper, Wyoming 82609, United States（アメリカ合衆国）'],
  ['電話番号', ON_REQUEST],
  ['メールアドレス', <a key="mail" href="mailto:support@modelxd.com">support@modelxd.com</a>],
  ['販売価格', '各サービスの画面に、実行前の目安として表示します（米ドル建て。日本語のページでは円の概算を併記します）。クレジットの購入は $10・$20・$100、または $1〜$1,000 の任意の金額。月額プランは日本では ¥749／月。'],
  ['商品代金以外の必要料金', 'ありません（インターネット接続の通信料はお客様のご負担です）。'],
  ['支払方法', 'クレジットカードなど、Stripe が提供する決済手段。'],
  ['支払時期', 'クレジットの購入は注文時に決済します。月額プランは申込時と、以後毎月の自動更新時に決済します。'],
  ['引渡時期', '決済の完了後、ただちにアカウントにクレジットを付与します。'],
  ['返品・キャンセル', 'デジタルサービスのため、購入後の返品はできません。クレジットは法律で求められる場合を除き返金できません。月額プランはアカウントページの「更新を停止」からいつでも解約でき、支払い済みの月の終わりまで有効です（月の途中の解約による日割りの返金はありません）。'],
  ['動作環境', '最新版の主要ブラウザ（Chrome、Safari、Edge、Firefox）。'],
]

const S = {
  p: { fontSize: 14, lineHeight: 1.75, color: 'var(--muted2)', marginBottom: 10 },
  dt: { fontSize: 13, fontWeight: 800 as const, color: 'var(--white)', margin: '18px 0 4px' },
  dd: { fontSize: 14, lineHeight: 1.75, color: 'var(--muted2)', margin: 0, paddingBottom: 14, borderBottom: '1px solid var(--border)', overflowWrap: 'anywhere' as const },
}

export default function TokushohoPage() {
  return (
    <main id="xtell-main" tabIndex={-1} lang="ja" style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px', outline: 'none' }}>
      <div className="prompt-label eyebrow">Legal</div>
      <h1 className="page-headline" style={{ marginBottom: 16 }}>特定商取引法に基づく表記</h1>
      <XCreateLegalNote />
      <p style={{ ...S.p, fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>最終更新：2026年9月29日</p>
      <p style={S.p} lang="en">
        Commercial disclosure under Japan&apos;s Act on Specified Commercial Transactions, for
        purchases made from Japan. The Japanese text below is the one that applies.
      </p>
      <dl style={{ margin: '8px 0 0' }}>
        {ROWS.map(([k, v]) => (
          <div key={k}>
            <dt style={S.dt}>{k}</dt>
            <dd style={S.dd}>{v}</dd>
          </div>
        ))}
      </dl>
    </main>
  )
}
