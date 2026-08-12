---
name: luxury-product-tvc
description: Direct a premium, high-end product commercial from a single product photo — slow deliberate camera moves, controlled specular light, seamless backdrop, and copy that sells craft over specs. Use when the user wants a luxury, editorial or "TVC" feel for a physical product such as a bag, watch, fragrance, jewellery or footwear.
license: Proprietary. ModelXD.
compatibility: Designed for ModelXD XDirector (video generation with reference images)
metadata:
  author: ModelXD
  emoji: "💎"
  banner: "/xdirect/skills/luxury-product-tvc.webp"
  color: "#b8894a"
  title: "Luxury Product TVC"
  version: "1.1"
  category: commercial
  aspect: "9:16"
  default_duration: "6"
---

# Luxury product TVC

You are directing a premium commercial. The product is the hero and the only
subject that matters. Restraint reads as expensive; busyness reads as cheap.

## Workflow

Even a single-shot TVC starts as a one-scene storyboard (set_storyboard):
the card carries your shot design, the model and the price, and the user
edits and approves there. A longer spot (10-15s) is two or three scenes —
same set, same light — and at generation time each scene after the first is
chained from the previous one (chain_from_scene) so the space carries across
the cut; the light and set consistency below travels in the FRAME, not in
repeated adjectives. Generate in order, only when the user asks.

## Shot design

Choose ONE move and commit to it. Luxury work does not cut inside six seconds.

- **Slow orbit** — camera arcs 20-40 degrees around the product at product
  height. Best for bags, bottles and footwear with a strong silhouette.
- **Push-in reveal** — camera starts wide on negative space and eases in to a
  tight three-quarter. Best when the product has one signature detail.
- **Rack focus** — hold the frame still, pull focus from a foreground edge to
  the product's hardware or logo. Best for watches and jewellery.

The move must be slow and continuous. Never combine two moves, never whip-pan,
never add cuts.

## Light

Large soft key from high 45 degrees, a single hard specular kicker to define
one edge, deep falloff to near-black or seamless white. One consistent light
temperature. No coloured gels unless the user asks. The highlight should travel
along the product's edge as the camera moves — say this explicitly in the
prompt, it is what makes the material read as real.

## Staging the reference

The product must be present and correct in the FIRST frame and stay in frame
throughout. Name the reference explicitly and restate its invariants — colour,
material, hardware finish, stitching, logo placement — so the model cannot
redesign it mid-shot. Nothing may enter or leave the frame.

## Setting

Seamless studio sweep, matte stone slab, or brushed metal plinth. Nothing else
in frame: no props, no hands unless the user asks for a lifestyle beat, no
text, no watermark, no background objects competing for attention.

## Copy tone

If the user wants copy, sell craft and material, not specification. Short
declarative lines. Never exclamation marks, never emoji, never "amazing" or
"stunning". Three to six words per line.

## Anti-patterns

Confetti, sparkles, lens flares, floating product with no ground contact,
rotating turntables that spin more than once, stock-music-video energy, and
any camera move fast enough to motion-blur the hardware.
