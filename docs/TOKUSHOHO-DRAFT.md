# 特定商取引法に基づく表記 — draft (Sep 29)

A Japanese tester asked whether the paid service needs a
「特定商取引法に基づく表記」 page before launch in Japan. Online sales to
consumers in Japan (通信販売) are normally expected to show one. This is a
draft of what it would say, built from how the site actually charges today
(lib/stripe.ts, lib/plans.ts, the Terms). **Not published.** The fields
marked ◆ need the owner's details, and someone qualified in Japanese
consumer law should confirm the wording before it goes live.

| 項目 | 内容 |
|---|---|
| 販売業者 | ◆ (legal name of the seller: company or individual) |
| 運営統括責任者 | ◆ |
| 所在地 | ◆ |
| 電話番号 | ◆ |
| メールアドレス | ◆ |
| 販売価格 | 各サービスの画面に、実行前の目安として表示します（米ドル建て、日本語ページでは円の概算を併記）。クレジットの購入は $10・$20・$100、または $1〜$1,000 の任意の金額。月額プランは日本では ¥749／月。 |
| 商品代金以外の必要料金 | なし（インターネット接続の通信料はお客様のご負担です）。 |
| 支払方法 | クレジットカードなど、Stripe が提供する決済手段。 |
| 支払時期 | クレジットの購入は注文時に決済。月額プランは申込時と、以後毎月の自動更新時に決済。 |
| 引渡時期 | 決済完了後、ただちにアカウントにクレジットを付与します。 |
| 返品・キャンセル | デジタルサービスのため、購入後の返品はできません。クレジットは法律で求められる場合を除き返金できません。月額プランはいつでも「更新を停止」から解約でき、支払い済みの月の終わりまで有効です（日割りの返金はありません）。 |
| 動作環境 | 最新版の主要ブラウザ（Chrome、Safari、Edge、Firefox）。 |

When the ◆ fields are known: publish as `/tokushoho` on www, xtell and
xcreate (add it to each door's route list in `lib/site.ts`), and link it
from the footers beside Privacy and Terms.
