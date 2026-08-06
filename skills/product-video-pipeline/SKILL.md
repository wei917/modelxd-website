---
name: product-video-pipeline
description: Turn one or more photos of a physical product into a finished sales video. Analyses the product, designs a scene that fits the requested length and budget, prepares clean reference plates when the source photo is cluttered, then generates with the best-scoring model the budget allows. Use when the user uploads a product photo and wants a video to sell it — bags, shoes, cosmetics, electronics, jewellery, packaged goods.
license: Proprietary. ModelXD.
compatibility: Designed for ModelXD XDirector. Needs reference-capable video models and image_edit for clean plates.
metadata:
  author: ModelXD
  version: "1.1"
  category: commercial
  cover: assets/cover.jpg
  aspect: "9:16"
  default_duration: "6"
---

# Product video pipeline

Four steps, in order. Do not skip ahead and do not ask the user to make
decisions you can make yourself.

## 1. Read the product before saying anything

Look at the attached photo and establish, silently: what the product IS
(category and sub-type), its colour and finish, its material, its hardware or
closures, where the branding sits, and its silhouette from the given angle.
Also note what is WRONG with the photo as a reference — cluttered background,
harsh flash, cropped edges, visible hands, watermark, low resolution.

Describe ONLY what you can actually see in the image. If no image reached you,
say so and ask for it — never guess colour, material, print or hardware. A
wrong guess does not just read badly, it overrides the reference image and you
get a video of a product the user does not own.

Never ask the user "what is this product?" when you can see it. If the category
is genuinely unreadable, that is the one thing worth asking about.

## 2. Design the storyboard ON THE BOARD, not in prose

Pick scenes from references/SCENES.md that fit the product category and the
requested length, then put them on the board with set_storyboard — that is
the deliverable of this step, not a chat description. Shot count follows
duration: a 5-6 second video is ONE scene; 10 seconds is two; 15 is three.
Never storyboard more scenes than the duration can carry — a six-second
video with three cuts looks cheap.

When consecutive scenes are one continuous action (the camera keeps moving,
someone enters and takes the product), say so in your chat line and, at
generation time, chain each one from the previous with chain_from_scene so
the space and light carry across the cut. Your chat line after
set_storyboard is one sentence plus the total price. Then STOP — the user
edits the cards and decides when to generate.

## 3. Prepare a clean plate only if the photo needs one

If step 1 flagged the source photo as a poor reference, generate a cleaned
version first and use THAT as the video reference. A clean plate is a STILL:
medium="image" with an image recipe (image_edit) — never a video recipe. It
may generate directly (prep stills are exempt from the storyboard rule) and
needs one line of warning about its small cost. Use the clean-plate prompt
in references/PROMPTS.md.

Skip this when the photo is already clean — it costs money and adds a
generation the user did not ask for. A plain product on a plain background
needs no clean plate.

If the user gave several photos of the same product, pass them all as
references rather than cleaning one; multiple angles hold the product better
than a single cleaned view.

## 4. Choose each scene's model against the budget

Call list_models BEFORE set_storyboard. Filter to models whose modes support
the recipe each scene needs — reference_frames when you have photos,
image_to_video when a scene opens on a start frame (every chained scene
does). Take the highest xd_score whose duration x per-second price fits the
user's stated budget; if none was given, treat $1.00 as the ceiling for a
first attempt. Record model, recipe and per-scene estimate ON the scene
cards; the cards are where the user approves the spend.

Generate only when the user asks, one scene at a time, in story order —
chained scenes cannot run before their source is done.

Write the final prompt with the anchoring rules in references/PROMPTS.md. The
product must be correct in the first frame and stay in frame throughout.

## After the result

React in one line. Offer exactly one next step: a different scene, a longer
cut, or the same scene on a higher-scoring model with the cost named.
