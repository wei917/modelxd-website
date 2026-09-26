# XCreate standalone UI

Built collaboratively by Codex and Claude Code's **XCreate page** task on September 26, 2026. Target: `https://xcreate.modelxd.com`.

## Delivery

- Claude's routing: `97e1644`.
- Claude's shell: `c1c58bb` (equivalent cherry-pick `228ddeb` in the Codex checkout).
- Codex checkout: `/Users/cwei/Documents/ModelXD_ChatGPT/xcreate-site`, branch `codex/xcreate-standalone`.
- Local production preview: `http://127.0.0.1:3030`.
- No deployment, DNS, Supabase settings, schema changes, or paid generations were performed for this UI build.

## Behavior

The XCreate host uses `/` for Create, `/?view=templates` for Templates, and `/?view=creations` for My creations. ModelXD's `/xcreate` retains its existing layout.

The standalone composer has a prompt before model selection, an 800px comfortable desktop width, two columns of chosen models, and wider results. Phones use one output selector and stacked model/result cards. Only one empty model slot is offered at a time, up to the existing four-model limit. The model picker wraps its metadata on small screens so names remain readable.

Templates, tools, and the existing public showcase live on Templates. Its category selection is independent of the studio's mode, so browsing does not clear a draft. Applying a template uses the existing live catalog and template logic. Navigation preserves the active creation; polling preserves the selected view. New creation explicitly resets the studio.

My creations reads the existing session-authenticated, paginated `/api/profile/xcreates` endpoint with its existing ownership filtering and signed media URLs. Cards reopen the existing `?id=` restore flow. No new database endpoint or public policy was added.

Guests can browse the standalone UI. Generate, prompt improvement, creating a product board, and templates that upload a sample require sign-in. The API authentication and billing checks remain unchanged. The shared `useRequireAuth` default remains unchanged for other pages.

New studio/navigation copy supports English, Traditional Chinese, Simplified Chinese, Japanese, and Korean. Existing model names, template prompts, and engine messages retain their current translations.

## Verification

- `tsc --noEmit --incremental false`: passed.
- `next build --webpack`: passed, including TypeScript and page generation.
- `git diff --check`: passed.
- Browser: desktop and 390px/320px layouts; no horizontal overflow in the tested Create and My creations views.
- Browser: draft retained through Create → Templates → Create; template application prefills the real prompt and model recommendations; New creation clears the draft.
- Browser: Japanese at 320px; one output selector, readable model list, model picker opens/closes.
- Browser: guest Generate opens branded sign-in without posting a generation; dialog closes; My creations shows its sign-in state on a 401.
- Production preview loaded successfully after the build.

OAuth round trip, a signed-in user's saved-media history, and paid generation were not exercised in this session. The existing engine and wallet were reused.

## Release

Integrate only the scoped XCreate commits into the intended release branch; the shared dev branch also carries unrelated work. Configure the domain on the existing Vercel project and apply the DNS target Vercel supplies. Add `https://xcreate.modelxd.com/auth/callback` to the Supabase redirect allowlist. Verify sign-in, account/credits, saved creations, and the intended release's existing generation flows on the actual host before announcing it live.
