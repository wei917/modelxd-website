# XTELL-PAGE.md — X算命 (`/xtell`)

> Everything about the XTell surface. Written 2026-08-30, updated 2026-09-01
> (關帝廟 + 四面佛 + 九曜廟; 媽祖廟, 姓名亭, 測字亭 Sep 22), verified against the code the same day. Read this before touching `app/xtell/*`, `lib/xtell.ts`,
> `lib/classics.ts`, or `app/api/xtell/*`.

## What it is

Fortune telling as an application surface, aimed at the Taiwan/Japan market.
**Entertainment, clearly labeled (僅供娛樂), and kept far from anything
measured** — it must never share a byline with XEval's benchmark claims.

The design metaphor is the owner's: **each template is a Temple (廟)**. You
don't open a chat about love — you visit 月老廟. The street page lists the
temples; each temple is one divination method with its own ink-wash cover
(house art language: painterly, no robots, no AI-slop).

## Two front doors (Sep 23–24)

`xtell.modelxd.com` serves the same app through `lib/site.ts` + `proxy.ts`
(see `docs/XTELL-CODEX-BRIEF.md` for the contract and the split of work with
Codex). On that host `app/page.tsx` renders `XTellClient` at `/`, the shell
is Codex's D2+D5 explorer (`app/components/xtell/*`: one large selected
temple portrait, purpose copy, a real entry button, and an illustrated
icon-plus-label menu for the ten methods; assets in `public/xtell/approved/`,
provenance in Codex's design directory), and non-XTell pages 302 to `/`.
**Art decision (owner, Sep 24):** the standalone host uses those
sculptural portraits and screenprint icons, not the ink-wash covers; the
ink-wash rule below still governs `/xtell` on www and every temple cover.
The host is attached to Vercel's Production target, so it ships with `main`.

## The architecture rule (the one thing you must not break)

**The model never computes the chart. Code computes the chart; the model only
interprets it.**

```
user birth input → server library computes the chart (deterministic, checkable)
                 → chart facts serialized into the MASTER's system prompt
                 → user chats; every turn carries the facts natively
                 → model writes the reading, billed at list price
```

Why: a model recalls 干支 calendar rules impressively well (all four frontier
models passed the 立春 trap unaided — tested Aug 29) but "usually right" is
the worst place to be, because a wrong 排盤 is instantly checkable against
any Taiwanese 排盤 site and torches credibility. A library is right every
time for free. The models' job is the part with no right answer: the reading.

## Temples (11 live)

| temple | method | engine | notes |
|---|---|---|---|
| 八字廟 | BaZi four pillars | `lunar-typescript` (MIT, zero deps) | 節氣-exact: year pillar turns at the 立春 INSTANT (20:40:24-level precision), 五虎遁/五鼠遁, 藏干, 十神, 納音, 大運 via `getYun(gender)` |
| 紫微斗數廟 | Zi Wei Dou Shu | `iztro` (MIT) | 12 palaces, major/minor/adjective stars, brightness + 四化 (mutagen), 五行局, 命主/身主. Needs an exact hour — 命宮 cannot be placed without one. **運限 (Sep 24):** `a.horoscope(date)` gives the 大限 in force (natal palace + age range), this year's and next year's 流年, and the current 流月, each with its 命宮's natal palace, its 四化 by star, and the role→natal-palace map (流年官祿 = 本命 X 宮). Serialized in `ziweiFacts` and shown on the board; `ziweiChart(b, now)` takes the date so the golden suite freezes it. Before this both masters correctly said the chart had no 流年 |
| 月老廟 | 合婚 (two people) | `lunar-typescript` ×2 | Two birth rows (第一位/第二位, each with own gender — defaults M+F, fully editable). Both charts ride the system slot; 查看命盤 stacks two boards |
| 關帝廟 | 靈籤 (求籤 + 擲筊) | `content/qian/guandi.json` + `lib/xtell-ritual.ts` | No birth, no chart. Ritual: draw 1–100 (browser crypto), throw 筊 until **three 聖筊 in a row** (笑/陰 → redraw). Only the NUMBER travels; the poem + six Qing commentaries load from disk on the server. Added Sep 1. **稟告 (Sep 24, optional, both 籤 temples):** a collapsed block for 稱呼, 縣市 and a birth row; whatever is filled in goes to the master (`bingGaoFacts`), a birth adds the 八字 + this year's 流年 under the stick (same `liuNian` as 四面佛). Never an address; nothing stored. 籤是主、命是輔 is in both prompts |
| 媽祖廟 | 六十甲子籤 (求籤 + 擲筊) | `content/qian/mazu.json` + `lib/xtell-ritual.ts` | Same ritual as 關帝廟 with a 60-stick tube (`QIAN_COUNTS`). Wikisource《天上聖母六十甲子籤》, the set used at 鎮瀾宮/朝天宮: 甲子 label, a 五行/season/direction line (shown neutral, it is a hint not a grade), four lines, 卦頭故事. No per-topic 解曰 in this edition, and the master is told so. Added Sep 22 |
| 姓名亭 | 姓名學 (五格剖象) | `lib/names.ts` + `content/names/kangxi.json` | Surname + given name (1–2 chars each, 繁體). 康熙筆畫 from Unicode Unihan `kRSUnicode` at the radical's FULL form (氵=水 4, 艹=艸 6, 阝=阜 8/邑 7, 月=肉 6, 王=玉 5−1=4), numerals by value. 天/人/地/外/總格, 熊崎式 81 數理 (吉/半吉/凶, wraps by −80), 三才 五行 生剋. Master never counts strokes; a second name goes back through the form. Added Sep 22 |
| 測字亭 | 拆字 | `lib/names.ts` + 《測字秘牒》 | One character + the matter asked. Code gives the 康熙 radical, its strokes, the character's strokes and the radical's 五行 (common radicals only). **The decomposition is the master's**, and the prompt makes it spell every part out so the visitor can check it, because no license-clean IDS dataset exists (CHISE/cjkvi-ids are GPL). Classic: 清 程省《測字秘牒》 from Wikisource via `lib/classics`. Added Sep 22 |
| 四面佛 | 四面許願 + 流年 | `lunar-typescript` | Birth row + four wish boxes (平安/事業/婚姻/財富, clockwise) + 還願 pledge. Chart = the visitor's 八字 plus `liuNian()`: this year's 天干 as 十神 vs 日主, 地支 vs 日支 and 年支 (太歲 label), the 大運 in force. The keeper says which face the year favours from THAT, not from vibes. Added Sep 1 |
| 九曜廟 | Jyotish (吠陀占星), Shani patron | `lib/jyotish.ts` on `astronomy-engine` 2.1 (MIT) | Needs a **birth place** (`lib/xtell-places.ts`, ~58 curated cities, IANA zones so DST resolves). Sidereal Lahiri; Lagna; nine grahas with sign/degree/whole-sign house/nakshatra-pada/D9; mean-node Rahu/Ketu; retrograde; Vimshottari maha + antar. Checked against Swiss Ephemeris within 15" on four charts. Added Sep 1 |
| 易學堂 | 易經: 起卦 / 查卦 / 問老師 | `lib/yijing-core.ts` + `lib/yijing.ts` + `content/yijing/zhouyi.json` | A school, not a temple (Sep 26). Three coins thrown six times → 本卦, 動爻, 之卦, and 朱熹's rule for which passage to read; any of the 64 read in the original; or a learner's question with no cast. See "易學堂" below |
| 占星塔 | 西洋占星 (tropical) | `lib/astrology.ts` on the same `astronomy-engine` | The one temple with ROOMS: 本命 / 星座配對 / 今日運勢 / 流年. Needs a birth place like 九曜廟. Placidus houses (equal above 66°, said on the board), ten planets through Pluto, mean nodes, Part of Fortune by sect, Ptolemaic five with wider orbs for the lights. 配對 = synastry + composite. 今日 = transits at a 1° orb with the exact date searched. 流年 = solar return + secondary progressions (Sun and Moon only). Added Sep 9 |

## 關帝靈籤 corpus (`scripts/fetch-guandi-qian.ts`)

Wikisource《關聖帝君靈籤》, 清刊本 (姑蘇鈕氏藏板), public domain. Fetched
through the MediaWiki API in two batches of 50 — anonymous bulk page loads
without a User-Agent get refused, which looked like throttling and was not.

The hundred pages were transcribed by two hands: **format A** (籤 1–10:
`<poem>`, `===聖意===` … `===占驗===`, the 甲子 label in the header) and
**format B** (籤 11–100: two 。-joined lines, `'''聖意：'''` …
`'''故事及記載：'''`, no label, ■ variant-character notes, and a modern
twelve-topic 解籤簿 (功名/六甲/求財…) pasted inside 聖意). The parser reads
both. The twelve-topic sheet is **dropped** — it is a 20th-century temple
sheet, not the Qing text, and its copyright is unknown; only the edition
that is clearly public domain goes in. The label for B is derived,
第n籤 = STEMS[(n-1)/10] + STEMS[(n-1)%10], and the parser asserts that
formula against every A page (第一籤 甲甲 … 第十籤 甲癸 … 第一百籤 癸癸).

The commentaries ride with the poem in `guandiFacts()` as citable original
text (聖意, 東坡解, 碧仙註, 解曰, 釋義, plus 占驗 on A and 典故 on B) — 一籤
一書 — so `lib/classics.ts` has nothing to retrieve for this temple and its
source list is empty. The golden suite checks count, four lines each, 聖意 +
解曰 everywhere, and three frozen sticks (1, 57, 100). The 57 expectation was
first written from memory as 庚庚 and was wrong (己庚) — the same lesson as
the 立春 case: observe, never recall.

## 媽祖 六十甲子籤 corpus (`scripts/fetch-mazu-qian.ts`)

One Wikisource page, sixty entries, one regex. The 籤 order is the
traditional one (甲子, 甲寅, 甲辰, 甲午, 甲申, 甲戌, 乙丑 …), stepping two
branches at a time, not the calendar's sixty-cycle, so never derive the
label from the number. The `Qian` shape is shared with 關帝: `luck` holds
the 五行 line, `sections` holds only 卦頭故事. `qianCorpus(temple)`,
`qianOf(n, temple)`, `validQian(n, temple)` and `guandiFacts(q, ask,
temple)` take the temple; the closing 允准 line names the right deity.

## 姓名 strokes (`scripts/build-kangxi-strokes.ts`)

Unicode dropped `kRSKangXi` from Unihan (gone by Unicode 17); `kRSUnicode`
is the surviving radical.residual field and encodes the same 康熙 convention
姓名學 uses: the radical at its full form plus the residual strokes, with a
NEGATIVE residual for reduced radical forms (王 = 玉 5 − 1 = 4). Radical
stroke counts come from each radical's unified-ideograph form via
`kTotalStrokes`, bridged by `CJKRadicals.txt`; simplified radical variants
(`120'`) are skipped. The only rule Unihan cannot know is the numeral
convention (一 … 十 count as their value), applied as an override. Scope is
URO + Extension A, 27,584 characters, 386 KB with the radical number kept
per character for 測字. The build spot-checks 48 surnames and given-name
characters against the tables 姓名學 books print; all hold. Inputs are
`Unihan_IRGSources.txt` and `CJKRadicals.txt` from unicode.org, not kept in
the repo.

## Saved readings (`supabase/105_xtell_readings.sql`, Sep 24)

Owner: people paid for these, both the chart and the conversation are kept,
and a saved reading is resumable. One row per temple visit:

- `/api/xtell/chart` inserts the row (subject = the request reduced to the
  keys the routes read, chart = what was shown, extras = match/year/bazi) and
  returns `readingId`. A save failure never blocks the chart (log only); until
  105 is applied the site simply behaves as before.
- `/api/xtell/reading` takes `readingId` + `qid` and, when the reply settles,
  calls `xtell_append_turns` (SECURITY INVOKER, runs under the visitor's own
  RLS): appends the question once per `qid` even when two masters answer,
  appends each assistant turn with model + cost, accumulates `cost_cents`,
  sets `title` from the first question.
- The account page lists rows (browser client, owner RLS): temple, title or
  「只排了盤」, date, question count, cost, Continue (`/?reading=<id>`),
  Delete (soft, `deleted_at`).
- Each temple's entry form also lists the visitor's saved visits to THAT
  temple (`TempleHistory`, owner Sep 24: history in each temple, not only
  the account page), with Continue (in place, via `onResume`) and Delete.
- `?reading=<id>` reopens: `XTellClient` fetches the row, opens the temple,
  and `TempleRoom` seeds every input, the chart, the extras and the turns
  from it, so the next question sends exactly what the original visit sent
  plus the saved history. The ritual shows as confirmed; the engine line is
  not stored and is blank on a reopened room.
- Proven on pglite before shipping: dedup, cost, title, cross-user isolation,
  anon denied (`has_table_privilege` / `has_function_privilege` false).
- **Await before close.** The append and the debit are awaited inside
  `onDone` before `controller.close()`. Vercel freezes the function when the
  response ends; the first live follow-up lost its append to exactly that.
  Any future write in a streaming route follows the same rule.

## The Jyotish engine (`lib/jyotish.ts`)

No mature JS library exists (surveyed Sep 1: `vedic-astro` is positions +
panchang with one star, `grahan` is Sun/Moon, `jyotishganit` is Python,
Swiss Ephemeris bindings are a native addon under AGPL). The whole thing is
~250 lines on `astronomy-engine`, which gives true-ecliptic-of-date
positions (`Ecliptic(GeoVector)` and `EclipticGeoMoon`) and sidereal time.

- **Ayanamsa**: Lahiri = 23.857092° at J2000 (the Swiss Ephemeris value,
  observed) + IAU 2006 general precession in longitude. Matches pyswisseph to
  0.0" on every test date.
- **Rahu**: Meeus mean node; Ketu opposite. Most Indian software defaults to
  mean node.
- **Lagna**: from GAST + longitude and the mean obliquity, standard formula.
- **Houses**: whole sign from the Lagna. **D9**: standard 9-fold division.
- **Dasha**: Vimshottari from the Moon's nakshatra, 365.25-day years; the
  antardashas of the current mahadasha are laid over its FULL span so a
  birth-truncated first period comes out right.
- **Time zones**: `zonedToUtc` resolves local wall time through Intl with the
  place's IANA zone, so 1985 Tokyo and 2000 New York both come out right
  without a tz database.
- **Verification**: `scripts/xtell-golden.ts` carries Swiss Ephemeris
  (pyswisseph, SIDM_LAHIRI) reference longitudes for four charts; the engine
  sits within 15" and the suite fails past 60" (a twentieth of a pada). The
  remaining ±12" is aberration/nutation modelling, invisible at pada scale.
  Reference numbers were produced in a scratch venv (`pip install
  pyswisseph`) and copied in — regenerate the same way if the engine changes.

The facts serializer names each 宿 in Sanskrit plus the 宿曜經 Chinese
equivalent (Ashwini = 婁 … Revati = 奎; the Tang mapping drops 牛/Abhijit),
and the classics corpus for this temple is the 宿曜經 itself
(`content/classics/suyaojing.txt`, Wikisource, fetched via the API's
`variant=zh-hant` because the page is stored in simplified script).

## The Western engine (`lib/astrology.ts`)

Built on the same `astronomy-engine` as `lib/jyotish.ts`, and deliberately so:
that file already computes TROPICAL longitudes and a tropical ascendant and
then subtracts the Lahiri ayanamsa. Western astrology is those numbers without
the subtraction, so the ephemeris, the timezone handling and the arcsecond
accuracy were already paid for. `scripts/test-astrology.ts` asserts the
relationship holds (`tropical - Lahiri == sidereal`, to 0.0").

What is genuinely ours, and how each part is checked:

- **Placidus houses.** Placidus divides each quadrant by TIME, so every cusp
  depends on its own declination and has to be iterated. It is verified from
  its DEFINITION rather than against a published table: the suite takes the
  cusp the code returns, independently recomputes that degree's declination and
  semi-diurnal arc, and asks what fraction of its own arc it has travelled.
  Cusps 11, 12, 2 and 3 land on exactly 1/3 and 2/3 to nine decimal places. A
  second test pins the closed-form case: at the equator every ascensional
  difference is zero, so Placidus must collapse to equal thirds of right
  ascension, and it does.
- **Above |lat| 66°** a degree of the ecliptic can be circumpolar: it never
  rises, so there is no arc to divide and Placidus has no answer. The engine
  returns equal houses and sets `system: 'equal'`, which the board prints. A
  silent NaN or a quietly wrong cusp would be far worse than saying so.
- **No Chiron, no asteroids.** `astronomy-engine` has no ephemeris for them.
  A number we cannot check has no business on a board whose whole promise is
  that it is checkable.
- **Transits at a 1° orb.** Roughly a day of solar motion. A wider orb puts
  thirty aspects in force every day of the year, which is the same as having
  none: it cannot say what is different about today. The exact date is found
  by bisection over a ±45-day window, so a retrograde planet reports the next
  crossing rather than pretending there is only one.
- **Progressions report the Sun and Moon only.** The outer planets barely move
  in ninety days, so a progressed Pluto is the natal Pluto with a decimal on
  it. The angles are left out because progressing them needs a choice between
  Naibod, solar arc and progressed sidereal time that the schools disagree on,
  and picking one silently would make the board unverifiable.
- **The solar return** is found by bisection to the second and cast at the
  BIRTH place, so the room needs no second input. Verified by the definition:
  the return Sun lands on the natal Sun within an arcsecond.
- **Composite midpoints are taken the short way round.** The long way puts the
  composite Sun opposite where every other program puts it.

**Nothing is stored.** 今日運勢 is the one room someone returns to daily, and
the birth row for it lives in the visitor's own browser (`localStorage`, key
`xtell.zhanxing.birth`), wrapped in try/catch because a private window throws
on access rather than returning null. A birth date, an exact time and a place
is the most identifying thing anyone types into this site and XTell holds no
personal records at all; a table only earns itself if a chart ever has to
follow someone across devices or feed a notification.

**占星塔 has no classics corpus** (`lib/classics.ts` declares `[]`). Its
classics are Ptolemy and Lilly, neither of which is in `content/classics`, and
pointing it at 《宿曜經》 because that file mentions the twelve signs would
ground a Western reading in a Buddhist text about a different system.

## 易學堂 (Sep 26)

Owner: a learning hall where an AI teacher answers beginners; structured
courses and videos come later (scripts for ten one-minute chapters exist in
the conversation, not in the repo). Built with Codex, who reviewed the
engine independently and made the art.

- **Corpus** — `scripts/fetch-zhouyi.ts` builds `content/yijing/zhouyi.json`
  from 維基文庫《周易》 (public domain): 卦辭, 彖, 大象, six 爻辭 with 小象,
  用九/用六, 文言 on 乾/坤, page revision ids. Every page must agree three
  ways or the build fails: its own 第N卦, its 「X下Y上」 trigram line, and the
  yin/yang pattern of its 爻 labels. The 十翼 remainder (繫辭上下, 說卦, 序卦,
  雜卦, under `易傳/` because `周易/繫辭上` is a redirect) goes to
  `content/classics/zhouyi-*.txt` for 問老師's retrieval.
- **Corrections** — 42, the only edits, each in the JSON with a witness
  edition: simplified slips (后/後, 系/係/繫, 丑/醜, 云/雲, 愿/願 …) found by
  sending every distinct character through Wikisource's zh-hant converter and
  reading each hit in context; two wrong characters (剛柔際也, 長裕而不設);
  one broken phrase (剝：不利有攸往, Codex). Right-as-classical forms stay:
  于, 无, 恒, 輿尸, 渙奔其机, 鴻漸于干, 辟難, 變化云為, and 后 = sovereign in
  three 大象. The converter misses characters valid in both scripts (系 was
  found by hand), so a new corpus needs the same context pass.
- **The rule** — 朱熹《易學啟蒙·考變占第四》 as printed in 《性理大全書》卷十七,
  quoted per case on the board. 彖辭 there means the 卦辭. Two and four
  moving lines carry his own 「經傳無文，今以例推之」. Three moving lines:
  both 卦辭, 本卦 = 貞, 之卦 = 悔, 前十卦主貞/後十卦主悔; the source names the
  endpoints for 乾 and 坤 (玉齋胡氏), and for the other 62 the split (初爻
  among the moving lines = 前十) is derived from the same 卦變圖 order. The
  board, the facts and the code all say so. Six moving: 乾 用九, 坤 用六,
  others the 之卦 卦辭.
- **Not 納甲** — the three-coin throw is only a way to get six lines. No 世應,
  六親, 納甲干支 or 六神 is computed, and the teacher is told not to add them.
- **Tests** — `scripts/test-yijing.ts` (in `npm run test:xtell`): 朱熹's own
  左傳/國語 casts (屯之比 … 穆姜 艮之隨, 蔡墨 乾之坤), the 乾/坤 前十/後十
  endpoints, Codex's ten independent cases verbatim, all 4096 casts
  resolving to text that exists, the corpus against the table.
- **Room** — `app/components/xtell/Yixue.tsx`: hexagrams are drawn from data
  (SVG), never by an image model; the matter asked locks at the first throw
  (一事一占, with 蒙's 「初筮告，再三瀆」); the cast lives in a ref like the 籤
  ritual so fast clicks cannot lose a line; the sixth line enters the hall. A
  cast row is titled by its matter. Board: the rule quoted with its source
  link, the passages to read (lead marked), then each hexagram's full text
  folded, with its Wikisource page, revision and corrections.
- **Art** — Codex's standalone `public/xtell/approved/yixue-portrait.avif`
  and `yixue-icon.avif` (six solid bars, three coins; decoration only). The
  5×2 sheets are untouched: `TEMPLE_ART` takes `src` for a temple added after
  them. www's street shows the portrait until an ink-wash cover exists.

## The room flow (owner's design, Aug 30: "hide as much as possible")

1. Birth date + time + gender → **進廟**. The chart is computed at that moment
   (free) so bad dates fail before any chat. The chart is NOT shown.
   關帝廟 replaces the form with 所問之事 + the ritual (`RitualPanel`): the
   third 聖筊 calls the chart route itself, so there is no 進廟 button.
   四面佛 adds `WishForm` under the birth row; at least one face must be
   filled (`validWishes`). 九曜廟 adds a place `<select>` (`PLACES`) and
   hides 時辰不確定, since the Lagna needs the hour. 姓名亭 and 測字亭 have
   no birth row at all (`NameForm`, `CeziForm`); the gender radio in 姓名亭
   rides on the shared `birth.gender`.
2. Chat, XDirect's composer exactly (Enter sends, Shift+Enter breaks).
   **Master chips** above: up to 4 models (Sep 24; was 2), default preselected
   (`DEFAULT_MASTER = 'qwen3.8-flash'` in `app/xtell/client.tsx` since Sep 24,
   owner's call, with thinking ON as its default pill — native in the
   classics, a hundredth of Sol's price, first word in seconds; falls back to
   `qwen3.8-max`, then `gpt-5.6-sol`, then the newest enabled text model).
   Every seated master answers every question; each keeps its own private
   thread (its replies only) so masters never contaminate each other.
   Each reply shows model + actual cost. Several masters = 合參 — the ModelXD
   thesis in temple robes. Two layouts (owner, Sep 24), remembered per
   browser: **並排** (one column per reply, ≥360 px each, the row scrolls
   sideways past two) and **分頁** (a button group of every model that has
   answered, with its summed cost; one reply at a time; the phone default).
   Nobody has to pick one to continue; 「只留這位老師」 drops the others for
   whoever wants to stop paying for them. A reopened reading re-seats the
   masters of its last round.
3. `查看命盤` (dotted link) expands the full board for verification, with the
   **engine provenance line** (`排盤引擎: lunar-typescript v1.8.6`).
4. Per-seat settings (Sep 24, owner: configure each master like an XCreate
   slot, and follow XCreate's UI): a ⚙ on each chip opens the panels for ALL
   seated masters together, collapsed by default — one card per master in
   its slot colour (`SLOT_COLORS`), built from the shared `OptPill` /
   `OptGroup` in `app/components/OptControls.tsx` (lifted out of XCreate),
   with **thinking level** pills (Auto + the row's
   `output_config.text.thinking_levels`) and **web search** Off/On (only
   where the row declares `web_search`). The reading request
   carries `thinking` and `search` per seat; the route accepts a level only
   if the row declares it. House default: Qwen Flash `thinking_true`, other Alibaba rows
   `thinking_false` (Max's own default sat 130 s before the first token on a
   紫微 prompt); the UI shows the default as the selected pill so Auto is a
   deliberate choice.
   Clicking a master's name opens the picker to **replace** that seat, so the
   first master is as changeable as the second. The old global search
   toggle is gone.

No auto-send anywhere: an intro line is static text; nothing spends until the
user types (same rule as XDirect's `?q=`).

## Files

```
app/xtell/page.tsx          # server shell (title/meta)
app/xtell/client.tsx        # street + TempleRoom chat + BirthRow + boards
app/api/xtell/chart/route.ts    # POST {temple, birth[, birth2]} → chart + engine. Free, auth required.
app/api/xtell/reading/route.ts  # POST {temple, birth[, birth2], question, modelId, history, search}
                                #   → SSE stream; bills list price at settle (XCreate chat pattern)
lib/xtell.ts                # charts, facts serializers, ENGINES, MASTERS, validBirth,
                            #   關帝 corpus loader + guandiFacts, 四面佛 liuNian + simianfoFacts
lib/xtell-ritual.ts         # client-safe ritual: drawQian / throwJiao / cryptoRand / CONFIRM_THROWS
lib/jyotish.ts              # Vedic engine: sidereal positions, Lagna, D9, nakshatra, Vimshottari, facts
lib/astrology.ts            # Western engine: tropical positions, Placidus houses, aspects,
                            #   transits, secondary progressions, solar return, synastry + composite
lib/xtell-places.ts         # curated birth places (lat/lon/IANA zone) for temples that need one
lib/names.ts                # 姓名學 五格 + 81 數理 + 三才; 測字 character facts (server-only)
lib/yijing-core.ts          # 易學堂 engine, client-safe: trigrams, King Wen table, coin cast,
                            #   本卦/之卦, 朱熹's reading rule with its source sentences
lib/yijing.ts               # 易學堂 server half: 周易 text, board payload, the teacher's facts
content/yijing/zhouyi.json  # 64 hexagrams + 42 witnessed corrections (scripts/fetch-zhouyi.ts)
app/components/xtell/Yixue.tsx  # hexagram glyph (SVG), coin ritual, 64 picker, board
scripts/test-yijing.ts      # 易學堂 suite (in npm run test:xtell)
content/names/kangxi.json   # char → [康熙筆畫, radical no] (built by scripts/build-kangxi-strokes.ts)
content/names/radicals.json # radical no → [char, strokes]
content/classics/cezimidie.txt  # 《測字秘牒》 — 測字亭's grounding text
lib/classics.ts             # 古籍 retrieval (see below)
content/qian/guandi.json    # 關聖帝君靈籤 100 首 (built by scripts/fetch-guandi-qian.ts)
content/classics/suyaojing.txt  # 《宿曜經》 (Tang, 不空譯) — 九曜廟's grounding text
scripts/fetch-guandi-qian.ts    # corpus builder (MediaWiki API, both transcription formats)
scripts/generate-xtell-covers.ts # temple covers, gpt-image-2 in the ink-wash house style
content/classics/*.txt      # 《滴天髓》42 chapters + 《紫微斗數全書·卷一》 (Wikisource, public domain)
scripts/xtell-golden.ts     # golden-chart suite — npm run test:xtell
scripts/test-astrology.ts   # Western engine suite (same npm script); Placidus checked against
                            #   its own definition, not a table — see below
public/xtell/*.jpg          # temple covers (ink-wash, gpt-image-2)
```

## Masters (system prompts in `lib/xtell.ts` MASTERS)

Per-temple personas (廟裡的老師; 月老 himself in 月老廟; the 解籤老師 in 關帝廟,
never 關帝 himself; a Thai 守願人 at 四面佛; a Jyotishi under Shani's shrine
at 九曜廟, never the god; a 姓名學 老先生 at 姓名亭; a 廟口測字先生 at 測字亭).
Shared guardrails:

- Only the provided chart — never recompute or alter a pillar.
- **Tendency tone** (learned from Wolke/ziwei-doushu's ETHICS.md): 傾向/容易/
  偏向/宜留意 — never 一定/注定/必然. Encoded as the shared `TONE` constant.
- 月老 extra: never declares a relationship doomed (clash-heavy pairings get
  what-to-tend framing); refuses third-party snooping; safety issues →
  serious referral to real resources, out of persona.
- 關帝 extra: one stick, one matter (一事一籤); quote the commentaries by
  name (聖意/東坡解/解曰) and never claim the stick says what its notes do
  not; if 所問之事 is blank, ask before reading.
- 四面佛 extra: it is 許願, not 算命 — help word the wish concretely, read the
  computed 流年 against the four faces, keep the pledge affordable; no
  vendors, dancers or proxy-worship services; no wishes against third parties.
- 九曜 extra: sidereal, so the Sun sign is usually one earlier than Western
  (say so, it is not an error); 宿 named Sanskrit + 宿曜經 Chinese; remedies
  (gems, mantras) are cultural notes, never instructions; Shani is a teacher
  of discipline, not a curse.
- 姓名 extra: the 81 數理 is called a convention, never a law; no pushing a
  name change; a second name must go back through the form, the master
  never counts strokes itself.
- 測字 extra: spell out every component of the decomposition; use only the
  character's real structure; one character, one question.
- 易學堂 extra: a teacher, not a diviner. Original text in 「」 with its source,
  everything else labelled as interpretation; never quotes text it was not
  given; never recasts; says which passage the rule picks and why, with
  朱熹's caveats; every term glossed for a beginner; no 納甲.
- No medical/financial/legal directives. Ends with 僅供參考與娛樂.
- 繁體中文 unless the visitor writes otherwise.

## Classics grounding (`lib/classics.ts`)

Idea from Sudo-Biao/Chinese-Metaphysics-Platform (MIT): a 批文 that quotes
《滴天髓》 reads like a master; free prose reads like a chatbot.

- Corpus: public-domain texts fetched from zh.wikisource.org, cleaned of wiki
  markup, split into ≤420-char quotable passages. 八字/月老 → 滴天髓;
  紫微 → 紫微全書卷一.
- Retrieval: CJK-bigram overlap (no tokenizer needed), scored against the
  question PLUS the chart facts — so a questionless full reading still
  retrieves on the actual 日主's vocabulary. Top 3 passages.
- Injected into the system slot as OPTIONAL citable material: quote by book
  title when relevant, ignore otherwise, **never fabricate a classic** —
  everything quotable exists on disk and is checkable.

## 時辰不確定 (unknown birth hour)

Common in TW. Checkbox per birth row (hidden in 紫微廟ompute — 命宮 needs an
hour). Chart computed at noon internally but `baziFacts(..., hourUnknown)`
serializes THREE pillars only, marks 大運 start-ages approximate, and orders
the master to disclose the limit and keep 時柱-domain claims (晚年/子女/內心
底色) soft. Idea from vedic-astro-skills' rectifier; a future rectifier
temple (deduce the hour from life events) is on the backlog.

## Golden charts (`npm run test:xtell`)

Frozen OBSERVED outputs (never hand-recalled — the first version froze two
remembered values and both were wrong; the suite caught its own author):

- 1990-01-01 15:25 → 己巳 丙子 丙寅 丙申 (pre-立春 trap; model-verified 4/4)
- 1985-07-20 09:00 → 乙丑 癸未 庚申 辛巳 (model-verified)
- 2000-02-04 **12:00 vs 21:30** — same calendar day straddling the 20:40:24
  立春 instant: 己卯/丁丑 vs 庚辰/戊寅, day pillar 壬辰 unchanged
- 1988-06-15 23:30 晚子時 → 戊辰 戊午 辛丑 庚子 (day pillar stays, 子時 stem
  from the NEXT day's stem — 日不變、時遁次日干 school; frozen so a library
  upgrade silently switching schools fails loudly)
- 紫微 1990-01-01 申時 → 命宮己巳 巨門[旺], 木三局, 命主武曲/身主天機

Run it before shipping ANY dependency bump that touches lunar-typescript or
iztro.

## Studied repos (owner-shared, Aug 30 — learn, credit, respect licenses)

| repo | took | license line |
|---|---|---|
| Wolke/ziwei-doushu | tendency-tone ethics rule | CC BY-NC-SA — **learn only** |
| CNWU16/vedic-astro-skills | hourUnknown; (backlog: rectifier) | AGPL + commercial restrictions — **never copy** |
| Horace-Maxwell/horosa-skill | provenance line; golden-fact tests; 合參-flags-contradictions framing | AGPL — **learn only** |
| Sudo-Biao/Chinese-Metaphysics-Platform | classics KB + retrieval; independent confirmation of pillar algorithms | MIT — portable with attribution |

## Backlog (owner picks)

- ~~籤詩亭~~ — shipped Sep 1 as 關帝廟, Sep 22 as 媽祖廟. Other 籤 sets (
  觀音一百籤) would be new corpora on the same ritual.
- ~~印度 temple~~ — shipped Sep 1 as 九曜廟 (one temple, Shani patron; the
  owner's 太陽神廟/納迪葉 ideas would be further personas over the same
  engine). Not yet: divisional charts beyond D9, Shadbala, transits, true
  node option, a free-text geocoder for places outside the list.
- Birth-time rectifier temple; 六爻亭 (interactive coin ritual); 擇日
- 真太陽時 toggle (Taipei ≈ +6 min vs UTC+8 meridian)
- ~~Persistence~~ — shipped Sep 24 (see "Saved readings"); 流年 refresh of an old chart is still open
- Share cards for 批文; XDev MCP exposure of chart tools
- More classics (淵海子平, 三命通會) as corpus grows
