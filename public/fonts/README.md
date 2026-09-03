# public/fonts — XCut's subtitle fonts ONLY

This directory is not general font storage. `lib/xcut-render.ts` passes it to
ffmpeg as `fontsdir=`, and `bundledFont()` returns the family name of the
**first** `.ttf`/`.otf` in readdir order — which is then written into the ASS
`Fontname`. libass silently draws nothing when that name does not match a font
that has the glyphs, so the wrong file here breaks subtitle burning with no
error anywhere.

**Do not add a font here unless XCut should be allowed to render subtitles in
it.** Anything sorting before `NotoSansTC-Regular.ttf` takes over every burn;
a Latin-only face there means Chinese subtitles vanish.

This happened on 2026-09-03: two OFL fonts were vendored here for the template
card generator, `ArchivoBlack-Regular.ttf` sorted first, and it reached
production. Build-time fonts now live in `scripts/fonts/`, which nothing scans
and nothing serves.
