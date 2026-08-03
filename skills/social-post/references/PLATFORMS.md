# Platform specs

Read the row for the platform the user chose. Do not average across rows.

| Platform  | aspect_ratio | Images | Caption length | Notes |
|-----------|--------------|--------|----------------|-------|
| Threads   | 9:16         | 1–3    | ≤ 500 chars    | Vertical fills the feed. First image does the work; 2–3 read as a carousel. |
| X         | 16:9         | 1–4    | ≤ 280 chars    | Feed crops tall images hard. 16:9 shows whole in-timeline; 4 images tile 2×2. |
| Instagram | 4:5          | 1–10   | ≤ 2,200 chars  | 4:5 is the tallest the feed shows uncropped. Use 9:16 only for Stories/Reels. |
| LinkedIn  | 1:1          | 1–4    | ≤ 3,000 chars  | Square survives both desktop and mobile layouts. Restrained treatment reads better here. |

## Safe areas

Assume the bottom ~15% of a vertical image (Threads, Stories) may sit under
an overlay or caption on some clients. Do not put the subject's face, the
focal object or anything load-bearing there.

On X, the in-timeline preview may crop a 16:9 slightly at the sides. Keep the
subject away from the outer 8%.

## When the user says something else

Facebook feed → 4:5. TikTok → 9:16. YouTube thumbnail → 16:9. A blog header
or Substack → 16:9. Anything unlisted and unclear → ask once with chips
rather than guessing; the crop is not recoverable.
