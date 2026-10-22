# XNews: plan (not built)

Owner, Oct 19: "if we can use google search to find news for a region, can
we build XNews app? using AI to summarize and digest and comments?" Then:
read Google's grounding terms first, then a plan with two AIs per story, AI
commentators, comments, cost and legal. Nothing here is built.

> **Later Oct 19:** XDuel's news-ideas button (今日話題 below) was removed
> entirely, with its code and stored files; XNews itself is not started.
>
> **Update Oct 19:** the owner tried Claude Haiku 5.5 with Anthropic's web
> search on XDuel's news ideas and found the news quality "so bad ... don't
> use it"; that feature is hidden. So this plan's search source (section 4,
> step 1) is open again: a better source is the first thing to find.
> X was tried the same day and dropped (owner: "forget about X"): its
> Taiwan trends had no Taiwan topics, and Traditional Chinese posts had a
> median of 2 likes, mostly politics and fan posts.

## 1. The short answer

Yes, but **not on Google Search grounding.** Google's terms forbid exactly
the shape a news app needs (one search, shown to everyone, kept for the
day). Anthropic's web search allows it, as far as its published terms go,
and costs less per search. The rest (two AIs per story, commentators,
comments) reuses what XDuel and X體育 already have.

## 2. What the search providers allow

### Google (Gemini "Grounding with Google Search"): no

Gemini API Additional Terms, section "Grounding with Google Search"
(effective Mar 23, 2026, updated Apr 28, 2026;
https://ai.google.dev/gemini-api/terms). In plain words:

- A grounded result may be shown **only to the end user who submitted the
  prompt**, and always together with Google's Search Suggestions chip,
  unmodified, with nothing mixed into it.
- No caching, syndicating, analyzing or learning from grounded results, and
  no collecting their links for another purpose.
- Storing is allowed only for: tuning how they are displayed, that user's
  own chat history, a short refinement step, or a legal duty.

A shared hourly news feed breaks the first two rules. So does feeding a
grounded result into another model to rewrite it.

**今日話題 as built breaks them too** (this branch only; it is not on dev
or main). One house search per language per hour, stored for 12 hours,
shown to every user, rewritten into prompts by a second model, source links
shown without the chip. It must change before it ships. Three ways:

1. Move its search to Anthropic's web search (below), keeping the shared
   hourly pool. Cheapest and fastest; same pipeline.
2. Keep Google, but search per tap for that user only, show Google's chip,
   store nothing. About $0.035 and ~40 s per tap (measured below).
3. Ship XDuel without 今日話題 until 1 is built.

Recommendation: 1. **Done Oct 19** (owner: "Yes, move it"): Claude Haiku 5.5
with web search, ~$0.024 and 15-25 s per hourly build; the Gemini-built
pools were deleted from storage.

### Anthropic (Claude web search tool): yes, as far as published

- Docs (platform.claude.com, web search tool): $10 per 1,000 searches plus
  tokens; `user_location` (country) and `allowed_domains` supported. The
  one rule: when outputs are shown to end users, include citations to the
  original sources; if outputs are reworked or combined, show citations as
  the legal team advises.
- Commercial Terms (anthropic.com/legal/commercial-terms): the customer owns
  its Outputs; nothing about caching or redistributing search results. The
  only restriction nearby is reselling the Services, not Outputs.

### OpenAI (Responses API `web_search`): probably yes, not fully checked

- Docs: inline citations "must be made clearly visible and clickable";
  country via `user_location`; up to 100 `allowed_domains`. No storage rule
  in the guide.
- Service terms page refused the fetch (403). Read it before using OpenAI's
  search for anything shared.

## 3. The app

**Name:** XNews; X新聞 / X新闻 / Xニュース / X뉴스 (following X先知 and X創作).
Check the letter against the app-letters plan (docs/XFILM-PLAN.md: one app
per letter); N looks free.

**Where:** `/xnews` inside www's shell, like `/xoracle`. Reading needs no
account; voting and commenting do.

**Top bar:** topics, like X先知's rooms: 頭條, 台灣, 國際, 財經, 科技, 運動,
娛樂 (per language; Japan's own list for ja).

**A story page:**

1. Our own one-line headline and a few facts, each with its source links
   (publisher name + link, opening the publisher's page).
2. **Two AI digests side by side, blind** (A / B): the same facts, two
   models, each writes "what happened, why it matters, what to watch". The
   reader votes which explains it better, then sees the models and what
   each digest cost. That is XDuel's thesis applied to news, and the votes
   feed XBoard (the existing `text_search` pool fits: answers built on
   web search).
3. **Two AI commentators** under it, with different takes, drawn per story
   from the top models, one per maker (X體育's rule), fixed for that story.
   They post a first take when the story appears and answer when a reader
   @s them; they may answer each other once, never loop.
4. **Readers' comments**, the same room as X體育's chat: @ID beside the name,
   report with a reason, 3 reports hide, hide a person or the AIs, delete
   your own.

**Phone first:** one column; the two digests stack as A then B with the
vote under them; comments follow; the composer sticks to the bottom (as
X體育's rooms do).

## 4. Pipeline

1. **Find (hourly, per language, house-paid).** Claude Haiku 5.5 with web
   search, `user_location` = the region (Taiwan for zh-Hant, Japan for ja),
   `allowed_domains` = a reviewed list of major outlets per region, at most
   6 searches. Returns up to 10 stories: our own headline, the facts in our
   own words, 2-4 source links. Same language check and moderation as
   今日話題 (`lib/prompt-today.ts`).
2. **Merge.** A new story that is the same event as one from earlier today
   updates it (new facts, new links) instead of adding a duplicate; a cheap
   model decides "same event or not".
3. **Digest.** For each new story, two models drawn from different makers
   get the same input (our facts + the links) and write their digest.
   Same input for both is what makes the vote fair, and no article text
   passes through us.
4. **Comment.** The two commentators post their first take; later turns
   come from readers' @s.
5. **Keep.** Only our own text (headlines, facts, digests, comments) and
   the links are stored. No article text, no images from publishers.

## 5. Data (migrations to write when building)

- `xnews_stories`: id, lang, region, topic, headline, facts, sources jsonb
  ([{publisher, title, url}]), first_seen, updated_at, hidden.
- `xnews_digests`: story_id, slot (0/1), provider, model_name, text, cost,
  created_at. Two per story.
- `xnews_votes`: story_id, user_id, choice (0 / 1 / tie), created_at; one
  per person per story; feeds the rating pool.
- `xnews_messages`, `xnews_reports`: X體育's room tables, per story
  (`xsports_room_messages` is the model: public columns by column grant,
  Realtime, server writes only).
- `xnews_ai_spend`: the day's AI spend, with a cap, as `xsports_ai_spend`.

Every table service-key only except the public columns of messages
(Common Pitfalls 15 and 16), proven on PGlite first, checked live with the
publishable key after the owner runs it.

## 6. Cost (house-paid)

Measured today (今日話題, Gemini 3.8 Flash with Google Search, Oct 17-19,
28 runs): $0.035 per run on average, $0.15 at most, ~40 s. Writing with
Gemini 3.5 Flash-Lite: $0.002 per run, ~3 s.

Estimates per language per day, at list prices:

| Part | How | Per day |
|---|---|---|
| Find | 24 runs x (6 searches $0.06 + Haiku tokens ~$0.005) | ~$1.60 |
| Digests | ~20 new stories x 2 models (e.g. Sonnet 5 / GPT-6.1 Sol, ~2.5k in, 600 out: ~$0.011 each) | ~$0.45 |
| Commentators, first takes | ~20 stories x 2 x ~$0.01 | ~$0.40 |
| Commentators, replies to readers | grows with traffic; capped | cap |
| Moderation | OpenAI's moderation endpoint | free |

**~$2.50 a day per language before replies** (~$75 a month). If each digest
model searched on its own instead (3 searches each), digests rise to ~$3 a
day. Suggested reply cap: $10 a day per language at launch (X體育 uses $50
for all rooms), falling back to the cheapest pair once reached, as X體育
does.

## 7. Legal

- **Taiwan:** 著作權法 §9(1)(4): a news report written purely to convey
  facts is not protected; fair use for news reporting is §49 / §52 / §65,
  judged case by case. Copying an article's words is reproduction and
  rewriting it closely is adaptation; both need permission. So: our models
  write from facts in their own words, quote nothing beyond a few words,
  and always link the source.
- **Japan:** 著作権法 §10(2): mere reporting of facts and current events is
  not a protected work, but most articles carry protected expression. The
  Japan Newspaper Association said in Apr 2026 that AI search summaries
  threaten publishers and asked for opt-outs and law changes (statements
  also Jul 2024 and Nov / Dec 2025). Expect pushback in Japan: short facts,
  prominent links, and honour any outlet that asks to be left out
  (`allowed_domains` makes that one line).
- **Defamation and accuracy.** AI text about real people: the digests and
  commentators state only what the sources say, hedge the rest, never
  invent quotes; every story has a report button; a reported story can be
  hidden by the house at once.
- **Elections.** Taiwan's local elections are in late November 2026.
  Decide before launch whether political stories run during the campaign,
  and if so, both commentators must present more than one side.
- **Before launch:** a Taiwan / Japan IP lawyer reads sections 3, 4 and 7;
  OpenAI's service terms are read if OpenAI's search is used.

## 8. Phases

0. **Clear the way:** move 今日話題 to Anthropic web search (option 1
   above); read OpenAI's service terms; lawyer's read.
1. **zh-Hant, Taiwan:** finder, stories, two blind digests, vote, sources.
   No comments yet.
2. **Talk:** AI commentators and readers' comments (X體育's room code).
3. **ja, Japan;** XBoard's news pool; per-topic pages.

## 9. Decisions for the owner

1. Build it, and under which name and letter.
2. Blind digests with a vote (recommended), or named models from the start.
3. Launch language (recommended: zh-Hant first, then ja).
4. Daily cap for AI replies to readers.
5. Political news during Taiwan's election campaign: in or out.
6. 今日話題: option 1, 2 or 3 above.

## Sources

- Gemini API Additional Terms, Grounding with Google Search:
  https://ai.google.dev/gemini-api/terms
- Claude web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Anthropic Commercial Terms: https://www.anthropic.com/legal/commercial-terms
- OpenAI web search tool: https://developers.openai.com/api/docs/guides/tools-web-search
- 著作權法 (Taiwan), full text: https://6laws.net/6law/laws/著作權法.html
- 法律百科, news and copyright: https://www.legis-pedia.com/article/Intellectual-property-rights/488
- Japan Newspaper Association, Nov 2025 statement: https://www.pressnet.or.jp/statement/20251127.pdf
- 秋田魁新報, Apr 20 2026 (新聞協会 on AI search): https://www.sakigake.jp/news/article/20260420CO0091/
