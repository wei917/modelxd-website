# fonts — text burned into videos

`lib/caption-text.ts` draws the 風扇變裝 template's captions and 同款's
on-screen text with ffmpeg's `drawtext`, which has no font fallback: a letter
its font lacks comes out as a box. So each line is drawn in the first of these
that has all its letters, in its language's order:

- `NotoSansTC-Regular.ttf`: Traditional Chinese (the same file as XCut's in
  `public/fonts/`; git stores it once)
- `NotoSansSC-Regular.otf`: Simplified Chinese
- `NotoSansJP-Regular.otf`: Japanese
- `NotoSansKR-Regular.otf`: Korean

The SC, JP and KR files are the region subsets from Google's Noto CJK
(github.com/notofonts/noto-cjk, `Sans/SubsetOTF`), downloaded Oct 18. All
four are under the SIL Open Font License (`OFL.txt`).

Not served (outside `public/`) and not XCut's: `public/fonts/` stays XCut's
subtitle folder, where a new file can take over every burn (see its README).
`next.config.js` traces this folder into the routes that burn text.
