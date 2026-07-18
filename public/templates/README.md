# XCreate template previews

Drop preview files here using the template `id` as the filename. The
TemplatePicker UI auto-picks them up — no code change needed.

## Naming convention

```
public/templates/<template-id>.jpg     (or .webp, .png)
public/templates/<template-id>.mp4     (animated loop, optional)
```

If a file is missing, the card falls back to a gradient background with
the template's emoji centered — still looks intentional rather than broken.

## Expected files (15 templates)

| Template ID                | Suggested aspect | Recommended size |
| -------------------------- | ---------------- | ---------------- |
| titanic-bow                | 16:9             | 480×270          |
| diner-dance                | 16:9             | 480×270          |
| royal-throne               | 16:9             | 480×270          |
| astronaut-moon             | 16:9             | 480×270          |
| concert-stage              | 9:16             | 270×480          |
| cinematic-transition       | 16:9             | 480×270          |
| landscape-timelapse        | 16:9             | 480×270          |
| style-watercolor-anime     | 1:1              | 400×400          |
| style-3d-animated          | 1:1              | 400×400          |
| style-anime-portrait       | 1:1              | 400×400          |
| style-oil-painting         | 1:1              | 400×400          |
| style-vintage-polaroid     | 1:1              | 400×400          |
| style-cyberpunk-neon       | 1:1              | 400×400          |
| concept-art                | 16:9             | 480×270          |
| reasoning-compare          | 1:1              | 400×400          |

## Tool thumbnails (5 tools)

Small square thumbs shown in the compact tool cards (40px rendered —
keep files ~160×160). Ideally a before/after split crop ("eat your own
dog food": run the tool on a sample photo, crop the result). Emoji
fallback shows until the file exists.

| Tool ID                    | Suggested content            | Size    |
| -------------------------- | ---------------------------- | ------- |
| tool-remove-background     | subject half-cutout split    | 160×160 |
| tool-change-background     | backdrop swap split          | 160×160 |
| tool-fix-colors            | dull/corrected split         | 160×160 |
| tool-upscale               | blurry/sharp split           | 160×160 |
| tool-remove-objects        | with/without photobomber     | 160×160 |

## How to generate

Easiest path: "eat your own dog food." Run each template once on your
own ModelXD account with a representative input, save the best result,
crop/resize to ~400×400 or 480×270, drop into this folder.

For character-swap templates (Titanic, Diner Dance, etc.): use a
stock-photo or self-shot portrait for the reference image, *not* a
celebrity. Demo previews should match what real users will produce.

For style templates (Watercolor Anime, etc.): the same portrait restyled
through each model makes a clean side-by-side reference.

## Total size budget

~30KB per JPG × 15 templates = ~450KB. Lazy-loaded by the card so the
first paint doesn't wait on the full set.
