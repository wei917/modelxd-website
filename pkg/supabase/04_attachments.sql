-- ModelXD: attachments table

create table if not exists attachments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  bucket          text not null,
  original_path   text not null,
  resized_path    text,
  thumbnail_path  text,
  original_url    text not null,
  resized_url     text,
  thumbnail_url   text,
  media_type      text not null,
  file_name       text,
  file_size       int,
  created_at      timestamptz not null default now()
);

create index if not exists attachments_user_id_idx on attachments(user_id);

alter table attachments enable row level security;
create policy "attachments: owner access" on attachments for all using (auth.uid() = user_id);

-- FK back-references (run after 02 and 03)
alter table duels   add column if not exists attachment_id uuid references attachments(id);
alter table creates add column if not exists attachment_id uuid references attachments(id);
