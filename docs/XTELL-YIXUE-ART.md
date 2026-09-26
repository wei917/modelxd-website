# 易學堂 — approved school artwork

The owner selected **B 書院水墨**, specifically the corrected light-paper
concept, on September 26, 2026. The ink bagua and open book express a school
and replace the initial wooden Qian tablet and three coins.

## Assets

| Purpose | Production file | Size |
| --- | --- | --- |
| Explorer and room icon | `public/xtell/approved/yixue-school-icon.avif` | 300 × 300 |
| Explorer and www card illustration | `public/xtell/approved/yixue-school-portrait.avif` | 640 × 960 |

New filenames avoid stale cached artwork. The original files and the other
ten destinations' artwork sheets are retained. Both portrait placements
use `contain`; the school explorer fills its scene height on desktop and
mobile without clipping the bagua or book.

## Provenance

Generated and corrected through Codex's built-in image generation tool.
The selected reference and editable source PNGs are in the owner's workspace:

- `output/yixuetang-options-2026-09-26/b-ink-academy.png`
- `output/yixuetang-b-final/yixue-school-icon.png`
- `output/yixuetang-b-final/yixue-school-portrait.png`
- `output/yixuetang-b-final/prompts.md`
- `output/yixuetang-b-final/trigram-correction.md`

That workspace is `/Users/cwei/Documents/ModelXD_ChatGPT`. Production assets
are self-contained in this repository and do not depend on these paths.
Sharp only resizes and encodes the accepted PNGs to AVIF.

## Symbol review

Each artwork has eight distinct three-line trigrams around a taijitu. The
two lower diagonal groups were corrected in a separate image-generation
pass. In this Early Heaven arrangement, the clockwise order from the top is:

| Position | Trigram | Rows from outer rim toward center |
| --- | --- | --- |
| Top | 乾 Qian | solid, solid, solid |
| Upper right | 巽 Xun | solid, solid, broken |
| Right | 坎 Kan | broken, solid, broken |
| Lower right | 艮 Gen | solid, broken, broken |
| Bottom | 坤 Kun | broken, broken, broken |
| Lower left | 震 Zhen | broken, broken, solid |
| Left | 離 Li | solid, broken, solid |
| Upper left | 兌 Dui | broken, solid, solid |

This is decorative identity artwork. Actual cast and lookup charts remain
deterministic SVGs rendered from the calculated data.
