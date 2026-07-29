---
name: product-video-pipeline
description: Turn one or more photos of a physical product into a finished sales video. Analyses the product, designs a scene that fits the requested length and budget, prepares clean reference plates when the source photo is cluttered, then generates with the best-scoring model the budget allows. Use when the user uploads a product photo and wants a video to sell it — bags, shoes, cosmetics, electronics, jewellery, packaged goods.
license: Proprietary. ModelXD.
compatibility: Designed for ModelXD XDirector. Needs reference-capable video models and image_edit for clean plates.
metadata:
  author: ModelXD
  version: "1.0"
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

## 2. Design the scene, then state it in one sentence

Pick a scene from references/SCENES.md that fits the product category and the
requested length. Shot count follows duration: a 5-6 second video is ONE
continuous shot; 10 seconds is two; 15 is three. Never storyboard more shots
than the duration can carry — a six-second video with three cuts looks cheap.

Tell the user the scene in one sentence before generating, not as a question.

## 3. Prepare a clean plate only if the photo needs one

If step 1 flagged the source photo as a poor reference, generate a cleaned
version first with an image_edit model and use THAT as the video reference.
Use the clean-plate prompt in references/PROMPTS.md.

Skip this when the photo is already clean — it costs money and adds a
generation the user did not ask for. A plain product on a plain background
needs no clean plate.

If the user gave several photos of the same product, pass them all as
references rather than cleaning one; multiple angles hold the product better
than a single cleaned view.

## 4. Choose the model against the budget

Call list_models. Filter to models whose modes support the recipe you need —
reference_frames when you have photos, image_to_video for a single-image
animation. Then take the highest xd_score whose duration x per-second price
fits the user's stated budget. If no budget was given, treat $1.00 as the
ceiling for a first attempt.

State the model, its score and the exact cost before generating. If the best
model overshoots the budget, say what the budget does buy and what the extra
dollar would buy, then use the affordable one.

Write the final prompt with the anchoring rules in references/PROMPTS.md. The
product must be correct in the first frame and stay in frame throughout.

## After the result

React in one line. Offer exactly one next step: a different scene, a longer
cut, or the same scene on a higher-scoring model with the cost named.
