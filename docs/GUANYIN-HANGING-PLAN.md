# GUANYIN-HANGING-PLAN.md — 觀音廟: tie a stick outside, hang a wish

> Design only, written 2026-10-22. It was updated the same day with the owner's
> decisions and an online check of the customs. Nothing is built and no
> migration is written.
> Owner's ask: 「一般廟裡如果抽到不好的簽 會讓用戶掛在廟外。有些廟則是可以讓用戶付錢許願，然後也是掛在廟外。設計一下這些功能。」
> Read with `docs/XORACLE-PAGE.md` (觀音廟 row, room flow, 分享, saved readings).
> The room is called 觀音廟 / 观音庙 / 観音堂 / 관음사 / Guanyin Temple, the
> general name. No real temple is named anywhere in this feature, this doc
> included.

## Owner's decisions (Oct 22)

- A wish costs **$0.10** (owner: "$0.99 is fine but we can start from $0.1").
- Wishes are **public** (owner: "wishes should be public").
- **Sign-in is needed** for both features (owner: "users need to sign in to use the feature").
- A tied stick stays up **30 days** and a wish **1 year**.
- **觀音廟 only** for now.
- Up to **$10** may be spent on the work. Only the generated art costs money; about $1 is expected.

## How real temples do it (checked online, Oct 22)

- **Taiwan, a bad stick.** Folk articles say a 下下籤 is usually not taken home.
  People tie it on the temple's 結籤架 or burn it with 壽金, and they don't
  redraw at once. Practice varies by temple; these are blogs, not temple rules.
  ([uptogo](https://uptogo.com.tw/命理/下下籤意思？/))
- **Japan, 凶.** In a 500-person All About survey, 85% tie a 凶 at the
  shrine or temple, "to leave the bad air there". Taking it home is also fine.
  It is tied only at the marked place, and a slip kept at home goes back
  within about a year.
  ([All About](https://news.allabout.co.jp/articles/o/63890/), [All About guide](https://allabout.co.jp/gm/gc/220579/))
- **Names on 絵馬 (the opposite of our guess).** The custom is the wish on the
  front and the name and address on the back. Many shrines now say the address
  is not needed and initials or the prefecture are enough. Privacy stickers
  that cover a plaque are spreading because people photograph plaques and post
  them. Some plaques carried curses with the target's full name and address.
  ([Kinarino](https://kinarino.jp/cat8/28877), [President](https://president.jp/articles/-/78539), [KAI-YOU](https://kai-you.net/article/33716), [Gendai](https://gendai.media/articles/-/159812))
- **Price of a 絵馬:** ¥500–1,000 at large shrines.
  ([jeepe](https://www.jeepe.jp/ja/articles/ema-meaning-writing-guide-1726), [co-trip](https://co-trip.jp/article/320686))
- **Not found:** Taiwanese 祈福卡 prices, and how Korean temples' 소원지 are
  written or hung. (A plain wish card with a string sells for ₩500 online, but
  that is not a temple's.) The NT$ figure in the first draft was a guess and
  is gone.

**What this changes:** visitors will write names unless told not to. So the
plaque says so, phone numbers, emails and addresses are refused, and a quick
check looks for names on every wish. Following the Japanese sticker, a
writer may **seal** a plaque so only its back shows. Wishes stay public by
default, as the owner decided.

## What exists today

- 觀音廟 is live (`?t=guanyin`). `lib/xoracle-ritual.ts` draws 1–100 with browser
  crypto. Chinese, Korean and English pages then need one 聖筊. Japanese pages
  draw 元三大師 觀音百籤 with no 筊 (`needsJiao`). Only the number goes to
  `/api/xoracle/chart`, which reads the poem from `content/qian/guanyin-{yibai,gansan}.json`
  and, for a signed-in visitor, saves the visit (`xtell_readings`: `subject.n`,
  `subject.edition`, `chart.luck`). Guests get the stick, and nothing is saved.
- **"Bad" is not in the data for most pages.** The 觀音一百籤 (zh, ko, en)
  prints no 下 grade at all. Its grades run 上上 … 中平, and 26 slips print no
  grade. Many of those blank slips are the grim stories (石崇被害, 楚霸王陰陵失道),
  but we must not invent a grade (XORACLE-PAGE rule). Only the Japanese set has 凶
  (30 of 100, the published split).
- 四面佛 already has wishes, but they are free text sent to a teacher and never
  shown to anyone. This plan does not touch them.
- Existing pieces to reuse: `lib/moderation.ts` (OpenAI's free moderation,
  refuses when the check cannot run), X體育's reports (a fixed reason list and
  hiding at 3 reports, migrations 131/133), the cookie room's
  debit-then-refund pattern (`app/api/xoracle/chart/route.ts`), and `ShareButton`
  (the picture is drawn on the device, only when the visitor presses).

## Summary

| | Tie a stick outside | Hang a wish |
|---|---|---|
| Price | free | **$0.10** of credit (≈NT$3 / ¥15 / ₩140) |
| Sign-in | needed | needed |
| Shown on the wall | stick number, grade, date. Never the question, the name or the birth | the text, a stamp (平安, 學業 …), the date. A sealed plaque shows only its back. Never the account's name, @ID or picture |
| Stays up | 30 days, then 「化」 (off the wall, kept in the visitor's own history) | 1 year. 還願 (free) adds a red ribbon. The writer can take it down any time (no refund) |
| House cost | $0 | ≈$0.00007 a wish (one quick-model check). The margin is ~10¢ |

No model is called in either flow except that one check on a wish. Nothing
claims the bad luck is gone: the words are about leaving the worry behind, in
the masters' hedged tone.

## 1. Tie a stick outside (綁在廟外)

### Which sticks get the offer

- **凶 (Japanese set, 30 sticks):** the offer opens by itself under the slip, with
  the custom stated as a custom: 「凶のおみくじは、結んで帰る習わしがあります。」
- **Every other stick, every language:** one quiet line under the slip,
  「心裡不安嗎？可以把這支籤綁在廟外。」 The visitor decides what counts as bad. This
  is the only honest option for the 觀音一百籤, which prints no bad grade.
- Tying does not reopen the tube. 一事一籤 stays, which matches the Taiwanese
  advice not to redraw at once.

### Flow on a phone (375 px first)

Everything happens in place in the room's column. Nothing pops up (the owner
said so for X創作's tools, Oct 4).

1. The visitor draws (and throws 筊). `QianCard` shows the slip as today.
2. Under the slip, above the teacher seats, the **廟外 strip** appears: a
   generated picture of the rope rack, about 96 px tall, with a few real tied
   slips on it, then the line from above and the button **綁在廟外**. For 凶 it
   is a red pill. For the rest it is a text link.
3. Tap: the strip opens in place, with one sentence:
   「綁上去的只有籤號和日子，不會有你的名字或問的事。籤詩仍留在你的紀錄裡。」
   Then **綁上** / **先不要**.
4. Tap **綁上**: the slip folds into a strip and rises onto the rope (CSS motion on
   the generated slip art; a fade only under `prefers-reduced-motion`). The
   line becomes 「綁好了。不安留在這裡，路還是自己走。」 with **看看廟外**.
5. The teacher seats and composer stay below, unchanged. A visitor can still
   pay a 師姐 to read the stick. The reading request gets one fact,
   「信眾已把這支籤綁在廟外」, so the 師姐 can mention it kindly. The prompt adds
   a rule: never say tying it removes anything.
6. One tie per visit (`readingId`). A second tap shows 「已綁在廟外」. A
   reopened visit (`?reading=`) shows the same state.

**A visitor who is not signed in** still draws for free, as today. Tapping
綁在廟外 opens the sign-in dialog (closable). The stick has to survive the
sign-in, because the room's form normally starts again. So the chart route's
answer for a 籤 temple adds a `drawToken`: an HMAC of temple, edition, number
and time, valid 2 hours, the same idea as `lib/site-token.ts`. The room keeps
the token and stick in `sessionStorage`. After sign-in it saves the visit
from the token (the server re-reads the poem, so nobody can hang a stick they
did not draw) and finishes the tie. The draw is not repeated.

### Desktop

The same strip runs the room's full width (1280 px container). The rope
becomes one long rack, and the slip flies from the card to the rope. Same
words, same order.

## 2. Hang a wish (掛許願牌)

### Entry points

- In the 觀音廟 room, under the ritual panel, before anyone draws: the 廟外
  section (the rack of sticks plus a rack of plaques) ends with **掛許願牌**.
- After any stick, the 廟外 strip carries a second, quieter link: 「也想許個願？」.
- The full wall (below) has **＋ 掛許願牌** pinned to the bottom on a phone.

### Flow on a phone

1. Tap **掛許願牌**: a visitor who is not signed in gets the sign-in dialog
   first, and comes back to the plaque. A signed-in visitor sees a blank plaque
   (generated art) open in place, full column width, with the text drawn on it
   as they type. Limit: 60 characters in any language, with a live count.
   Placeholder: 「寫下你的心願（大家都看得到，不寫名字、電話、地址）」.
2. **What for** (optional, one tap): 平安 · 健康 · 學業 · 姻緣 · 事業 · 財運 · 其他.
   The stamp sits on the plaque, and it is all a sealed plaque shows.
3. **Seal**, off by default: 「封起來，只給觀音看」. This is the privacy sticker
   Japanese shrines now offer. Sealed, others see only the back: the stamp and
   the date. Left off, the wish is public, which is the default the owner chose.
4. The price line, `掛一年 · 0.10 美元`, then the balance, then **掛上 · 0.10 美元**.
5. On press, the server does the following in order and charges nothing until
   every check passes:
   1. Length, then a pattern check: phone numbers, emails, links, LINE/IG ids,
      street addresses and runs of 6+ digits. The plaque is refused, sealed or
      not.
   2. `moderate()` on the text (it is free). If the check cannot run, an
      unsealed plaque is refused and the visitor is offered the seal.
   3. **Unsealed only:** one quick house-model check (GPT-6 Luna, ~500 tokens).
      Does the text name or point at a person, wish harm on someone (詛咒),
      sell something, or carry personal facts? If yes, the visitor sees
      「願文裡好像有人名或個人資料，請拿掉，或封起來再掛。」. A family word like 媽媽 or
      my son is fine. A name, even only a given name, is not.
   4. `debitCredits` 10¢ (`referenceType 'xtell'`, the ledger's existing key; `referenceId 'wish:<id>'`),
      then the insert. If the insert fails, refund at once (the cookie pattern).
6. If credits are short: the usual top-up link, with the text kept in
   `sessionStorage`.
7. Once hung, the plaque swings onto the rack and the wall opens at it (marked 你的).
   **分享** draws the plaque on the device (no name), only on a press.
8. Later, under 「我的心願」 in the room and on Profile's X先知 tab, each wish shows
   its date and days left, plus three controls:
   - **封起來 / 打開**: opening runs check 5.3 then.
   - **還願**: a red ribbon on the plaque; free.
   - **取下**: no refund.

### Desktop

The plaque editor sits beside the plaque rack, and the price and button sit
under the plaque. Same steps.

## 3. The wall (廟外)

- **Where:** a section of the 觀音廟 room, plus a full view at
  `?t=guanyin&wall=1` (in the room's own address; Back returns; no popup).
- **What it shows:** two racks.
  - Sticks: the newest first. Each slip shows 第N籤 and its grade as printed
    (blank stays blank), the edition's mark (一百籤 / 元三大師), and the month
    and day.
  - Plaques: an open plaque shows its text, stamp, date and a ribbon if 還願.
    A sealed one shows its back.
  - Counts on top, real only, for example 「今天 12 支籤 · 4 個心願」. **Never
    seeded with made-up entries.** An empty rack is just the painted rack.
  - The reader's language comes first, then the others, untranslated (as the
    XDuel vote feed does).
- **Who sees it:** everyone, signed out too. Writing needs an account; reading
  does not. The wall API returns only the fields above, plus `mine` for the
  caller's own rows. It never sends a user id, name, @ID, avatar, country or
  the question.
- **Tap a plaque:** it grows in place to full text with **檢舉** (reasons:
  個資 · 騷擾 · 仇恨 · 色情 · 廣告 · 其他, optional details ≤300). At 3 reports it is
  hidden from others. The writer still sees it, marked 「已隱藏，只有你看得到」,
  and gets no refund. Admins (ADMIN_EMAILS) get **隱藏** on every plaque.
- **Loading:** pages of 60 from `GET /api/xoracle/wall` (public, CDN-cached
  30 s), with the caller's own rows fetched separately. That keeps the cached
  page free of anyone's session.

**Why the checks matter more now:** with public plaques, the risks are the
two the Japanese articles report: plaques photographed and posted with
names on them, and plaques that curse a named person. The placeholder, the
pattern check and the name/curse check cover both, and the seal is there for
anyone who wants it. A photo of our wall can only show what passed the
checks.

## 4. What is stored (migration 151, the next free number today)

`151_xoracle_hangings.sql`. Take the number again from `origin/dev` right before
writing it. The owner runs it by hand. Prove it on PGlite first, then check it
live with the publishable key.

```
xoracle_hangings                       one row per tied stick or hung wish
  id             uuid pk default gen_random_uuid()
  kind           text not null  check in ('stick','wish')
  temple         text not null default 'guanyin'  check in ('guanyin')
  user_id        uuid not null references auth.users on delete cascade
  reading_id     uuid null references xtell_readings(id) on delete set null
  edition        text null  check in ('yibai','gansan')
  stick_no       smallint null  check between 1 and 100
  luck           text null      -- copied from the corpus by the server ('' kept)
  wish_text      text null  check char_length between 1 and 60
  wish_for       text null  check in ('peace','health','study','love','work','wealth','other')
  sealed         boolean not null default false
  price_cents    int null   check >= 0
  fulfilled_at   timestamptz null       -- 還願
  lang           text not null  check in ('en','zh-Hant','zh-Hans','ja','ko')
  created_at     timestamptz not null default now()
  down_at        timestamptz not null   -- stick +30 days, wish +1 year
  taken_down_at  timestamptz null       -- the visitor took it down
  hidden_at      timestamptz null
  hidden_by      text null  check in ('reports','admin')
  report_count   int not null default 0
  check: a stick has edition + stick_no + luck and no wish fields;
         a wish has wish_text + price_cents and no stick fields
         (reading_id is required for a stick by the route, not the check,
         so that deleting an account can null it)
  unique (reading_id) where kind = 'stick'      -- one tie per visit

xoracle_hanging_reports
  hanging_id  uuid references xoracle_hangings on delete cascade
  user_id     uuid references auth.users on delete cascade
  reason      text check in ('personal_info','harassment','hate','sexual','spam','other')
  details     text check char_length <= 300
  created_at  timestamptz default now()
  primary key (hanging_id, user_id)

xoracle_report_hanging(p_id, p_user, p_reason, p_details) → (reports, is_hidden)
  -- wishes only, never one's own; insert the report (once per person),
  -- recount, hide at 3; under the plaque's row lock
```

**Written:** `supabase/151_xoracle_hangings.sql` (Oct 22), proven on PGlite
0.5.8: 51 of 51 checks pass (`prove151.mjs` in the session scratchpad). The
checks cover the shapes, one tie per visit, server-only access for anon and
authenticated (tables and function, with Supabase's default grants shimmed),
reports and hiding at 3, and the deletes.

**Applied 2026-10-22 by the owner, checked live:**
- **Publishable key:** select and insert get 42501 on both tables, and so
  does the rpc.
- **Service key:** a 61-character wish, a stick without its number and temple
  'guandi' all get 23514. A valid wish for a made-up account gets 23503. A
  report on a made-up plaque gets P0002.
- **Management API:** execute is false for anon and authenticated and true
  for service_role. authenticated has no table rights, RLS is on for both
  tables, and there are 0 policies.
- Nothing was stored (0 rows in both tables).

- Indexes: one on the wall, `(temple, created_at desc) where taken_down_at is
  null and hidden_at is null`, and one on own rows, `(user_id, created_at desc)`.
  The wall query also filters `down_at > now()`.
- **Service role only**, like 147/148. Turn RLS on, add no policies, revoke
  table and function rights `from public, anon, authenticated` by name (pitfall
  15), and grant to `service_role`. Every read goes through an API route.
  Live checks: the publishable key gets 42501 on both tables and the function;
  a wish without text and a 61-character wish are refused (23514); a second
  tie for one visit is refused (23505).
- Deleting an account deletes its wishes and ties (cascade). Deleting a visit
  leaves its tie on the wall without the link (`set null`), which also lifts
  the one-tie lock for that row. Harmless: the visit is gone.
- Nothing new in storage: all four pictures are static files.

Routes, none of which exist yet:
- `POST /api/xoracle/tie` (`readingId`, or `drawToken` right after sign-in)
- `POST` and `PATCH /api/xoracle/wish` (create; seal/open, 還願, 取下)
- `GET /api/xoracle/wall` (public page of the wall)
- `GET /api/xoracle/wall/mine` (the caller's own rows)
- `POST /api/xoracle/wall/report`

All of them answer 503 until 151 is applied, and the sections stay hidden.

## 5. Price and house cost

- **Wish: $0.10 of credit, hung for one year** (owner's starting price; $0.99
  was also fine with the owner). A 絵馬 costs ¥500–1,000 at large shrines, so a
  web plaque at about ¥15 is an easy first try. Japanese pages show
  「0.10ドル（約15円）」, as the cookie shows 「1セント（約1.5円）」.
- **House pays per wish:** moderation $0 (OpenAI's endpoint is free). The
  quick check runs on every unsealed wish: GPT-6 Luna at list price, ~500
  tokens in and ~30 out ≈ **$0.00007**. No picture is made per wish. Each wish
  nets about 10¢.
- **Tie: free, $0 to the house.** There is no model and no picture.
- **One-time art, about $1 (the owner allows up to $10):** four generated
  pieces in the painted set's style: the rope rack (it must tile sideways), a
  folded slip, a blank plaque, and the plaque's back. Generated as the 觀音
  icon was (GPT Image 2.5, ≈$0.022 a draft, ~6 distinct drafts each). Code
  only lays text over them.
- Not recommended: a picture painted per wish (GPT Image 2 is $0.005–0.04 a
  plaque, and it misspells text in pictures). It would also need picture
  moderation.

## 6. How long things stay up (decided)

- **Tied stick: 30 days**, then it leaves the wall (「已化」 in the visitor's own
  history). Temples clear and burn tied slips on their own schedule, and a
  kept slip goes back within a year.
- **Wish: one year from the day it was hung.** 還願 does not end it early.
  After the year it moves to 「我的心願」 as 「已圓滿」. Rows are kept until the
  visitor or the account deletes them.

## 7. The words (key buttons and lines, five languages)

The Japanese and Korean strings need a native read before shipping, as every
XOracle string did.

| key | en | zh-Hant | zh-Hans | ja | ko |
|---|---|---|---|---|---|
| section | Outside the temple | 廟外 | 庙外 | お堂の外 | 절 마당 |
| nudge (any stick) | Uneasy? You can tie this stick outside. | 心裡不安嗎？可以把這支籤綁在廟外。 | 心里不安吗？可以把这支签绑在庙外。 | 気がかりなら、このおみくじをお堂の外に結んでいけます。 | 마음에 걸리나요? 이 제비를 절 마당에 묶어 두고 갈 수 있어요. |
| nudge (凶, ja set) | — | — | — | 凶のおみくじは、結んで帰る習わしがあります。 | — |
| tie button | Tie it outside | 綁在廟外 | 绑在庙外 | 結んでいく | 묶어 두기 |
| tie note | Only the stick number and the date go up. Never your name or your question. | 綁上去的只有籤號和日子，不會有你的名字或問的事。 | 绑上去的只有签号和日子，不会有你的名字或问的事。 | 結ばれるのは番号と日付だけ。お名前やお願いの内容は出ません。 | 묶이는 것은 제비 번호와 날짜뿐, 이름이나 물은 일은 나오지 않아요. |
| tied | Tied. Leave the worry here; the road is still yours. | 綁好了。不安留在這裡，路還是自己走。 | 绑好了。不安留在这里，路还是自己走。 | 結びました。気がかりはここに置いていきましょう。 | 묶었어요. 걱정은 여기 두고 가세요. |
| see wall | See the wall | 看看廟外 | 看看庙外 | お堂の外を見る | 절 마당 보기 |
| wish button | Hang a wish | 掛許願牌 | 挂许愿牌 | 絵馬を掛ける | 소원패 걸기 |
| placeholder | Your wish (everyone can read it; no names, phone numbers or addresses) | 寫下你的心願（大家都看得到，不寫名字、電話、地址） | 写下你的心愿（大家都看得到，不写名字、电话、地址） | 願いごと（みんなが読めます。名前・電話・住所は書かないで） | 소원을 적어 주세요 (모두가 볼 수 있어요. 이름·전화·주소는 빼고) |
| seal | Seal it: for Guanyin's eyes only | 封起來，只給觀音看 | 封起来，只给观音看 | 封をして、観音さまだけに | 봉해서 관음보살님께만 |
| pay button | Hang it · $0.10 | 掛上 · 0.10 美元 | 挂上 · 0.10 美元 | 掛ける · 0.10ドル（約15円） | 걸기 · 0.10달러 |
| sealed back | A wish | 一個心願 | 一个心愿 | ひとつの願い | 하나의 소원 |
| came true | It came true | 還願 | 还愿 | 願いが叶った | 소원 성취 |
| take down | Take it down | 取下 | 取下 | 下ろす | 내리기 |
| report | Report | 檢舉 | 举报 | 通報 | 신고 |
| refused | It seems to name someone or hold personal details. Remove them, or seal it. | 願文裡好像有人名或個人資料，請拿掉，或封起來再掛。 | 愿文里好像有人名或个人资料，请拿掉，或封起来再挂。 | 人の名前や個人情報が含まれているようです。消すか、封をして掛けてください。 | 이름이나 개인 정보가 있는 것 같아요. 지우거나 봉해서 걸어 주세요. |

Wish stamps:

| en | zh-Hant | zh-Hans | ja | ko |
|---|---|---|---|---|
| Peace | 平安 | 平安 | 平安 | 평안 |
| Health | 健康 | 健康 | 健康 | 건강 |
| Study | 學業 | 学业 | 学業 | 학업 |
| Love | 姻緣 | 姻缘 | 良縁 | 인연 |
| Work | 事業 | 事业 | 仕事 | 사업 |
| Wealth | 財運 | 财运 | 金運 | 재물 |
| Other | 其他 | 其他 | その他 | 기타 |

## 8. Build notes (for whoever builds it)

- Same commit as the feature: `lib/xoracle-catalog.ts` (the 觀音廟 entry's `free` /
  `paid`, plus the catalog version), `content/xoracle-guide.md`, the 觀音廟 part of
  `content/site-guide.md`, and the 觀音 rows in `docs/XORACLE-PAGE.md` (the
  maintenance rule).
- `MASTERS.guanyin` gets two rules: a tied stick is a fact to acknowledge, and
  tying or wishing never changes the reading or removes anything.
- Terms/Privacy need a line about wishes: user-written text shown to everyone
  unless sealed, removable by the writer, hidden on reports.
- Tests:
  - one tie per visit, a forged or expired draw token, and sign-in needed for both;
  - the wish checks run before the debit, and a failed insert refunds;
  - a report hides the plaque at 3, and the wall API leaks no ids.

  The pattern to follow is `scripts/test-xoracle-votes.ts`.
- XTell is XOracle since 65cf9e84 (origin/dev). New names are `xoracle`
  (owner, Oct 22: "it's xoracle"): this feature's tables, routes and files.
  Saved data from before keeps `xtell`, as the rename left it:
  `xtell_readings`, and `referenceType 'xtell'` on the ledger (the cookie's
  debit uses it too).

## 9. Status

**Built Oct 22** on branch `claude/guanyin-wall` (not pushed): the routes
under `/api/xoracle/wall`, `app/components/xoracle/TempleWall.tsx` (the 廟外
section and the tie offer), the four pictures ($0.21 of drafts), the quick
check (measured $0.000037 a wish, 10/10 right), the 師姐's rule, the catalog
and guides, and `scripts/test-xoracle-wall.ts` (60 checks). Changed from
this plan while building: no `drawToken` (the chart route already takes the
stick number from the browser, so a token proves nothing; a stick drawn
signed out is saved through the chart route after sign-in); no
`?wall=1` address (the wall opens in place); the sealed editor types on the
front.
After a first look (owner, Oct 22): 廟外 sits above the visit history, as two
cards, 結籤處 (the rope rack, 先抽一支籤) then 許願牌, because temples keep the
tying place and the plaque rack apart. Then 許願牌 became a 絵馬掛け rack (owner:
"it should also be a wall or place to hang the 許願牌"): generated rack art,
three bars of nine hooks, real plaques on the hooks, tap to read.

- The seal stays (owner, Oct 22: "ok").
- The XTell → XOracle rename has landed on origin/dev (65cf9e84), so the build
  starts from there, in its own worktree.
- Build order once the owner says go:
  1. The four pictures (≤$10).
  2. Migration 151 (done: applied and checked live, Oct 22).
  3. The code.
