<!-- xtell-guide version: 2026-09-28.1 -->
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
optional), draw a numbered stick, then throw the two crescent blocks: one "sacred"
throw (one flat side, one round side up) confirms the stick, otherwise draw again. The poem and its old
commentaries are then read for that matter. A name, city and birth date can
be added for context but are not needed.

### mazu
媽祖廟 (Mazu Temple). The same draw-and-blocks ritual with Mazu's sixty
sticks, each named by a stem-branch pair; strong on travel, safety, home and
trade.

### guanyin
觀音廟 (Guanyin Temple). Hold one matter in mind (writing it down is
optional) and draw one of a hundred sticks, then read its poem for that
matter. 觀音廟 is the general name for a Guanyin temple, not any one real
temple: never say the sticks come from a named temple. On Chinese, Korean
and English pages the sticks are the 觀音一百籤 used across Taiwan
(seven-character poems), confirmed with one sacred block throw as at
關帝廟; on Japanese pages they are 元三大師's hundred five-character poems
(graded 大吉 to 凶), the set Japanese おみくじ come from, drawn with no
blocks. A name, city and birth date can be
added for context. A gentle room for worries, family and peace of mind.

### tarot
塔羅 (Tarot). Write what you want to know, choose one card (an answer) or
three (past, present, future), and shuffle; the cards are drawn by the
browser's own randomness, each upright or reversed. They are the original
1909 Waite–Smith cards, shown free with A. E. Waite's own meaning for each
(in English, from his 1911 book). Then the chosen teachers read the cards for
your question. Tarot here is for reflection, not prediction.

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
transits), cast in the tower from details entered there, with a teacher to
ask. For a free personal reading every day, see daily.

### zhanxing.year
占星塔, the year. The solar return for a chosen year and the progressed Sun
and Moon.

### xingming
姓名學 (Name Study). A surname and given name, one to three characters each,
in traditional Chinese characters, Japanese kanji or Korean hanja (not kana
or Hangul; 々 counts as the character it repeats): the
stroke counts, the five grids (天格, 人格, 地格, 外格, 總格), the traditional
81-number meanings and the balance of the three talents. The teacher reads
them and does not push a name change.

### cezi
測字 (Character Reading). Write one character, and if you like, the matter
you are asking about; the teacher takes the character apart into its
components and reads them against the matter, showing every step.

### jiemeng
周公解夢 (Dream Hall; 解夢 in the top bar). Write the dream as you remember
it, and if you like, what you want to know or what is going on in your life.
A quick AI reads the dream against 《周公解夢》, the classic folk dream
book, and picks the lines about what actually happens in it; they are shown
free and as written, each with its section (龍蛇禽獸等類 …). Then the chosen
teachers read the dream against those lines and your situation; they quote
only those lines, say that 「主…吉／凶」 is what the old book says rather
than a prediction, and suggest a doctor or counsellor for recurring
nightmares. The dream may be written in any language. Up to 30 dreams a day;
a dream already looked up keeps its lines.

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

## On the street itself

### daily
今日運勢 (the daily fortune), just below this guide, free every day. A
signed-in visitor saves their birth details once, after ticking a consent
box: the date (Gregorian), the time or "don't know", the time zone they were
born in (no city is asked), and the time zone they are in today (it decides
which date counts as today). The Western reading uses the planets only: the
rising sign and houses would need the birth place. They can view, change or delete them
there; deleting also removes the daily readings and the paid follow-up
conversations about them, and nothing else. Each day shows two separate
readings, each from its own calculation: Western astrology (today's
transits against the natal chart) and the BaZi day (today's day pillar
against the natal pillars). Each has a short summary, things worth noticing,
one thing to think about, and "why this reading" with the calculation. A
reopened page shows the same reading for the same day. With the birth time
unknown the readings still come, marked approximate where the time matters.
Asking a teacher about a day's reading is paid, with the estimate shown
before sending; the teacher sees only that day's calculation for that method.

### almanac
今日黃曆 (today's almanac, the farmer's almanac), a card just below this
guide beside the daily fortune; free, no birthday, no sign-in. It shows
today's date in the visitor's own time zone with the lunar date and the
day's stem-branch, what the day is traditionally good for (宜) and should
avoid (忌), the animal the day clashes with and the direction of 煞, the day
officer (建除), the solar term, the day spirit, the lunar mansion, the
auspicious and baleful stars and the Pengzu taboos, all shown at once. It comes
from the date alone. Tradition and reference, not a personal reading.

## Not live yet

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
- **Unknown birth hour.** BaZi, the bone weight, Western natal charts,
  matching and the daily fortune still work with limits; Zi Wei and Vedic
  charts need the hour.
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
