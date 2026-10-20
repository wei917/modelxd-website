-- 143_reserve_app_handles.sql — the new app names can't be taken as an @ID
-- (owner, Oct 17-20: XDev → XKit, XTell → XOracle, and XFilm planned).
--
-- handle_is_reserved() as in 132, with 'xkit', 'xoracle' and 'xfilm' added
-- to the list; lib/handle.ts has the same three (keep the two in step).
-- Nothing else changes. Replaces one function, safe to re-run. Run by hand in
-- the Supabase SQL editor (dev + prod share the project).
--
-- Check after:
--   select public.handle_is_reserved('xkit'), public.handle_is_reserved('x.oracle_2'),
--          public.handle_is_reserved('xfi1m'), public.handle_is_reserved('swift_otter_482');
--   -- true, true, true, false
--   select has_function_privilege('anon', 'public.handle_is_reserved(text)', 'execute');
--   -- false: 132's revoke stays (create or replace keeps a function's grants)

create or replace function public.handle_is_reserved(h text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  with words as (select array[
    'admin','administrator','root','system','sysadmin','support','help','helpdesk','official','staff',
    'team','mod','mods','moderator','security','safety','info','contact','billing','payment','payments',
    'api','www','web','app','mail','email','null','undefined','anonymous','anon','guest','user','users',
    'me','you','everyone','all','here','ai','bot','xd','owner','founder','ceo','legal','privacy','terms',
    'abuse','report','verify','verified','login','logout','signin','signup','register','account',
    'accounts','settings','profile','home','news','blog','press','jobs','status',
    'xtell','xcreate','xsports','xduel','xtalk','xgame','xpersona','xvote','xboard','xdirect','xcut',
    'xworld','xarch','xdev','xeval','xchat','xkit','xoracle','xfilm',
    'gemini','grok','qwen','kimi','luna','sol','terra','astra','fable','opus','sonnet','haiku','deepseek',
    'minimax','hailuo','seedance','happyhorse','wan','veo','runway','midjourney','llama','mistral','sora',
    'nanobanana','commentator'
  ]::text[] as w),
  base as (select replace(replace(lower(coalesce(h, '')), '.', ''), '_', '') as s),
  forms as (
    select f, regexp_replace(f, '[0-9]+$', '') as bare
    from base, unnest(array[
      s,
      translate(replace(s, 'rn', 'm'), '013457', 'oleast'),
      translate(replace(s, 'rn', 'm'), '013457', 'oieast')
    ]) as f
  )
  select exists (
    select 1 from forms, words
    where f = any (w) or bare = any (w)
       or f ~ '^(gpt|chatgpt|openai|claude|anthropic)'
       or f ~ '^(admin|official|moderator)' or bare ~ '(admin|official|moderator)$'
       or position('modelxd' in f) > 0
  )
$$;
