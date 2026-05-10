-- Add chat_history column to xcreates table.
-- Stores the multi-turn conversation that happens after the user picks a model.
-- Format: jsonb array of { role, content, isImage?, isVideo? } messages.
-- NULL means no chat happened yet (user only did the initial generation).

alter table xcreates add column if not exists chat_history jsonb;

-- Allow owners to update their own rows (needed to save chat messages).
create policy "xcreates: owner update" on xcreates for update using (auth.uid() = user_id);
