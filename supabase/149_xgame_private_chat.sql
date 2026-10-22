-- 149: XGame chat, the private half (Oct 21, 2026). NOT RUN YET: the owner
-- runs it by hand in the Supabase SQL editor, after 148.
--
-- Owner (Oct 21): "we enable the chat room by default and have a low cost
-- fast model to be as commenter ... users can hire private AI to help. and
-- opponent can only see you hire someone but don't know what they tell
-- you"; "private and public chat room in the same game page". A message
-- with private_to set belongs to that player's own chat with the AI helper
-- they hired (lib/xgame-chat.ts); null = the table's public chat, where the
-- house commentator (GPT-6 Luna, paid by the house) speaks. The server
-- alone reads and writes the table (148), so the opponent never receives a
-- private row. Additive.

alter table public.xgame_messages
  add column if not exists private_to uuid references auth.users(id) on delete cascade;

-- A player's private chat at a table.
create index if not exists idx_xgame_messages_private
  on public.xgame_messages (table_id, private_to, id) where private_to is not null;

-- The house commentator's spend today (its remarks have no payer), for the
-- daily cap.
create index if not exists idx_xgame_messages_house
  on public.xgame_messages (created_at) where kind = 'ai' and user_id is null;

-- Checks after running:
--   publishable key: select xgame_messages (private_to) -> 42501
--   service key: a row with private_to = a made-up account -> 23503 (nothing
--   stored); a row with private_to = a real account reads back with it
