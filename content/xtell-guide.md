<!-- xtell-guide version: 2026-09-27.1 -->
<!--
  The X先知 front-door guide's knowledge (app/api/xtell/assistant). It pairs
  with lib/xtell-catalog.ts: which features exist, whether they are live, what
  they need and what they cost come from the catalog; this file explains how
  things work and what the traditions are. It states no prices and no
  statuses of its own. The version line above must equal
  XTELL_CATALOG_VERSION, every catalog id needs a "### <id>" section here,
  and scripts/test-xtell-assistant.ts checks both. Update both in the same
  change as the feature. Visitor-facing wording: no engine, library or
  validation details.
-->

# X先知 — what the guide knows

## What X先知 is

X先知 (XTell; X占い in Japanese, X운세 in Korean) is a street of temples for
Chinese, Western and Vedic fortune-telling traditions. A temple prepares the
chart, draws the stick or opens the text; then the visitor may ask an AI
teacher of their choice to explain it. Readings are for reflection and
entertainment, not advice: health, money and legal decisions belong with
qualified professionals.

## How a visit works

1. Choose a temple, or ask this guide which one fits.
2. Enter what the temple asks for: a birth date and time for the chart
   temples, a stick draw at the oracle temples (writing the matter down is
   optional), a name or one character at the name and character booths, a
   question at the I Ching school.
3. The chart, stick or text appears. The visitor can check it before going on.
4. To go further, the visitor picks a teacher and writes a question. The
   price estimate is shown before sending, and nothing is sent until they
   press send.

Entering a temple needs a Google sign-in. Visits are saved to the visitor's
account, where they can be continued or deleted. General questions to this
guide need no sign-in and no birth details.

## Temples and rooms

### bazi
八字廟 (BaZi Temple). The four pillars of the birth year, month, day and
hour: the day master (the person), the balance of the five elements, the
hidden stems and the ten-year luck pillars. Birth date in the Gregorian calendar; the hour may be marked unknown, and
then only three pillars are read and anything the hour decides is left out.

### bazi.chenggu
稱骨 (bone weight, 八字幾兩幾錢), shown on the BaZi board after the chart is
cast. A folk custom that adds traditional weights for the lunar birth year,
month, day and hour into a total in liang and qian (ten qian make one liang).
Heavier has traditionally been read as more fortunate; it is a custom, not a
tested prediction. With an unknown hour the board shows each possible total
instead of one. The BaZi board prepares a question for the teacher about it.

### ziwei
紫微斗數廟 (Zi Wei Temple). Twelve palaces (self, siblings, spouse, children,
wealth, health, travel, friends, career, property, fortune, parents) with the
stars that fall in each, plus the current ten-year period and this year. The
birth hour is required: the life palace cannot be placed without it.

### yuelao
月老廟 (Yue Lao Temple), for love and matching. Two people's birth details
give two BaZi charts and a compatibility score in which every row names the
pairing it read. Either hour may be unknown.

### guandi
關帝廟 (Guan Di Temple). Hold one matter in mind (writing it down is
optional), draw a numbered stick, then throw the two crescent blocks: three "sacred" throws in a row (one flat side, one
round side up) confirm the stick, otherwise draw again. The poem and its old
commentaries are then read for that matter. A name, city and birth date can
be added for context but are not needed.

### mazu
媽祖廟 (Mazu Temple). The same draw-and-blocks ritual with Mazu's sixty
sticks, each named by a stem-branch pair; strong on travel, safety, home and
trade.

### simianfo
四面佛 (Four-Faced Buddha). Write a wish to at least one of the four faces
(safety, career, marriage, wealth, clockwise), and if you like, how you will
give thanks. The keeper helps
word the wishes and reads which face this year favours from the visitor's
BaZi and this year's flow. It is making a wish, not fortune-telling.

### navagraha
九曜廟 (Navagraha Temple), Vedic astrology (Jyotish). Birth date, hour and
place give the ascendant, the nine grahas in signs and whole-sign houses, the
27 lunar mansions (nakshatras), the navamsa chart and the dasha timeline. The
hour and place are required.

### zhanxing.natal
占星塔 (Astrology Tower), natal chart. Sun, Moon and planets in the twelve
signs and houses, and the aspects between them. Birth date, time and place;
without the time there is no ascendant and no houses.

### zhanxing.synastry
占星塔, compatibility. Two people's charts compared, plus the composite
chart. Both birth dates and places are needed.

### zhanxing.today
占星塔, today. Today's planets against the visitor's natal chart (the
transits). This is the live way to look at "today" at X先知.

### zhanxing.year
占星塔, the year. The solar return for a chosen year and the progressed Sun
and Moon.

### xingming
姓名學 (Name Study). A surname and given name in traditional characters: the
stroke counts, the five grids (天格, 人格, 地格, 外格, 總格), the traditional
81-number meanings and the balance of the three talents. The teacher reads
them and does not push a name change.

### cezi
測字 (Character Reading). Write one character, and if you like, the matter
you are asking about; the teacher takes the character apart into its
components and reads them against the matter, showing every step.

### yixue.ask
易學堂 (I Ching Hall), ask the teacher. For learners: what a hexagram is,
how to read a line, what a passage means. No hexagram is cast here. The
teacher quotes the original text and marks everything else as
interpretation.

### yixue.lookup
易學堂, look up. Read any of the 64 hexagrams in the original text.

### yixue.cast
易學堂, casting practice. Name one matter, then throw three coins six times
on screen yourself; the hexagram, its changing lines, the resulting hexagram
and which passage to read follow the classical rule. Only when the visitor
wants to cast.

## Not live yet

### daily
Free daily fortune: a daily personal reading from both Western astrology and
the BaZi day, each with its basis, for visitors who choose to save their
birth details. Planned, not available yet. Today, the Astrology Tower's
"Today" room (zhanxing.today) is the live option.

### courses
Learning centre: short lessons in Western astrology, Vedic astrology and
Laozi. Planned, not available yet. The I Ching Hall (yixue.ask) is the live
way to learn today.

## Basic concepts (no birth details needed)

- **BaZi and Zi Wei.** Both start from the birth date and hour. BaZi reads
  the stems and branches of four pillars and the five elements; Zi Wei
  places stars in twelve palaces. BaZi can be read with an unknown hour
  (three pillars); Zi Wei cannot.
- **Western and Vedic astrology.** Western astrology uses the tropical
  zodiac, tied to the seasons; Vedic astrology uses the sidereal zodiac, tied
  to the stars, which is currently about 24 degrees behind. So a Vedic sign
  is often one sign earlier than the Western one: different zodiacs, not a
  mistake. Vedic astrology also uses the lunar mansions and the dasha
  periods.
- **Luck pillars and the year's flow (大運, 流年).** In BaZi a luck pillar
  covers about ten years; each year's stem and branch is read against the
  chart.
- **The BaZi year.** The BaZi year pillar changes at 立春 (around 4
  February), not at the Lunar New Year, so a January birth belongs to the
  previous year's pillar. The bone weight uses the lunar calendar year.
- **Oracle sticks.** One clear matter per draw; the blocks confirm the stick.
  The poem is a starting point for thinking, not a verdict.
- **The I Ching.** Sixty-four hexagrams of six lines. A cast gives a primary
  hexagram, possibly changing lines, and a resulting hexagram; the classical
  rule says which passage to read.
- **Unknown birth hour.** BaZi, the bone weight, Western natal charts and
  matching still work with limits; Zi Wei and Vedic charts need the hour.
- **Calendar.** Birth dates are entered in the Gregorian calendar (國曆). A
  lunar birthday needs converting first.

## What the guide never does

- It never computes or states a visitor's chart, pillars, bone weight, sign,
  ascendant, luck period, hexagram or stick. The temples compute these; the
  guide says which temple and what it needs.
- It never sends a question to a teacher or starts a draw or a cast; the
  visitor does that in the temple.
- It does not predict events and does not give health, legal or financial
  advice.
