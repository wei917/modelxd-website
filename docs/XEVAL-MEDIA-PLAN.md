# XEval media benchmarks — plan (drafted 2026-09-01)

XEval today is three text ladders (GDPval, Terminal-Bench 2.1, Harvey LAB).
ModelXD sells image and video, so the benchmark lab measures none of what the
product is actually for. This is the plan to fix that.

**The rule carried over from the text lanes: adopt a published benchmark
wherever one exists.** GDPval's value is that our ordering can be checked
against xAI's published AA Elos. A homemade media metric has no such anchor and
can be dismissed as marketing. We author our own tasks ONLY where nothing
public exists, and we say so on the page.

## What already exists, and what it costs us to adopt

| lane | public benchmark | metric | code | our gap |
|---|---|---|---|---|
| Image — text rendering | **AnyText-benchmark** (Alibaba, `tyxsspa/AnyText`) | Sen.Acc, NED | public | 简体 + EN only |
| Image — prompt adherence | **GenEval**, **DPG-Bench** | object/attr/relation; dense-prompt VQA | public | saturated ~0.91 |
| Image — extra axes | OneIG-Bench, TIIF, CVTG-2K, LongText-Bench, ChineseWord | mixed | public | — |
| Video — general | **VBench-2.0** (`Vchitect/VBench`) | 5 categories, 18 dimensions | public | cost |
| Video — editing | **IVEBench** (ICLR 2026, `RyanChenYN/IVEBench`) | 12 metrics / 3 dimensions, 600 videos | public | thin editing catalog |
| Lip sync | **LSE-D / LSE-C** (SyncNet, from Wav2Lip) | sync distance / confidence | public | SyncNet reliability |
| E-commerce | Taobao / Shopee published image specs | rule compliance | rules public, harness ours | — |
| Music video | nothing standard | — | — | fully ours |

## Phase 1 — Image text rendering (START HERE)

Cheapest lane and the most differentiated, which is a rare combination.

- **Adopt AnyText's metrics verbatim**: Sen.Acc (crop line, OCR, exact match)
  and NED (normalized edit distance). Not our metric — Alibaba's, published,
  with reference numbers already in the literature.
- **Adopt their reader-independence rule too.** AnyText deliberately scored with
  DuGuangOCR while training on PP-OCRv3. Same principle as our no-self-judging
  rule on GDPval and LAB: the reader never shares a family with the generator.
- **Extend where they stopped.** Their set is Wukong (简体, mainland) plus LAION
  (English). **繁體中文 and 日本語 appear in neither** — and those are ModelXD's
  two markets. This is the whole reason the lane is worth running.
- **Extend to the population they skipped**: AnyText benchmarks open research
  models that take a position mask. We test commercial APIs on plain prompts.
  Different task, no published numbers anywhere.
- **The control set decides whether this works.** Every reference string must be
  rendered in a real font and read back by the same OCR first. A string the OCR
  cannot read cleanly is disqualified from the set, never counted against a
  model. Without this we are measuring our OCR, not the models.
- Cost: ~$10-40 for ~100 prompts x our enabled image models.

## Phase 2 — Image prompt adherence

GenEval + DPG-Bench, subset. Buys comparability: everyone publishes these, so
our numbers are checkable. Expect them to be saturated and NOT to separate the
field (Qwen-Image 2.0 scores 0.91 GenEval, 88.3 DPG) — run them as the anchor,
not the headline.

## Phase 3 — E-commerce listability

Not a benchmark replication; the rules are the spec. Three tiers, only the third
needs a model:

1. **Mechanical** — dimensions, ratio, file size, format. Exact, free.
   Taobao: 1:1, >=800x800, <=5 images, first four <=3MB.
   The 5th must be 白底图: pure white, 800x800, **38K-300K**.
   Shopee: >=500x500, <=2MB, 72dpi, product fills >=70% of frame, >=3 images.
2. **Visual-programmatic** — white-background purity, product bounding box,
   shadow detection. Classic CV, deterministic, no model.
3. **Semantic** — no logo/watermark/QR/phone number, and text rendered as asked.
   Reuses Phase 1's OCR exactly.

Headline metric nobody publishes: **cost per listable image.**

Note what we CANNOT copy: Alibaba's Luban validates by production A/B bucket
test on click rate (+13% CTR reported, 1B images at Double 11 2019). That needs
a marketplace. Our verifier is rule-based by necessity, and the page must say so.

## Phase 4 — Video: VBench-2.0 subset

VBench-2.0 is the standard open T2V suite: 5 categories (Human Fidelity,
Creativity, Controllability, Physics, Commonsense), 18 fine-grained dimensions,
scored by LLM-assisted text alignment, video multi-question answering, and
specialist anomaly detectors. VBench Arena exists too (human votes) — we skip
that half; XDuel already is one.

**Cost is the binding constraint.** Video runs $0.10-0.40/second, so a 5s clip
is $0.50-2.00 against an image's $0.01-0.05 — two orders of magnitude. Full
VBench is ~950 prompts. Subset hard, the way TB went to 21 tasks and LAB to 19,
and log what was dropped.

## Phase 5 — Lip sync

LSE-D / LSE-C from SyncNet (Wav2Lip's metrics, the field's gold standard).
Reference: LSE-D ~6-8 is best-in-class alignment; Wav2Lip on LRS2 scores
LSE-D 6.386 / LSE-C 7.789. Datasets LRS2, LRS3, HDTF.

**Caveat to state on the page:** SyncNet-based metrics are criticized as
unreliable, and AV-HuBERT alternatives exist. Report the standard metric, name
the criticism.

Only two models qualify today (MiniMax H3, Wan 3.0 `audio_to_video`), so this is
a two-entry ladder until Alibaba's lip-sync trio reaches an International region
(see docs/STATE-2026-08-19.md — Beijing-only, and Beijing needs a mainland
account we cannot hold).

## Phase 6 — Music video

Nothing public. Fully authored, so it goes last and is labelled as ours.

## Constraints inherited from the text lanes

- **Complete rows only** — an entry appears when it has covered the full enabled
  set, never a partial average.
- **No self-judging** — reader/judge never shares a family with the generator.
- **Cost per task on every row**, which is the axis arenas structurally cannot
  report and the reason XEval exists.
- **Autopilot = per-category winner**, cheapest on ties. Same rule as GDPval
  sectors and TB categories.
- **Subset openly.** Log what was dropped; silent truncation reads as full
  coverage.

## Open decisions

1. Phase 1 reader: DuGuangOCR (AnyText's own choice) or PaddleOCR? Decide on the
   control set, not by reputation.
2. Where does the e-commerce check live — an XEval ladder, or a validator inside
   XCreate/XDirect that scores images as users generate them? Possibly both.
3. Which Shopee regional site defines the rules (TW and SG differ).
4. Video subset size, once someone prices a VBench-2.0 run against our catalog.
