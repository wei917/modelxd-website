-- supabase/133_xsports_report_reasons.sql — why a message in an X體育 live
-- room was reported (owner, Oct 14: "can you have a dialog to confirm and
-- fill more data? why 檢舉"): a reason from a fixed list (the page's report
-- dialog) and the reporter's optional words.
--
--   xsports_room_reports.reason   spam | harassment | hate | sexual |
--                                 misinfo (fans' messages) | wrong |
--                                 inappropriate (the AI commentator's) | other
--   xsports_room_reports.details  up to 500 characters (the page sends 300)
--
-- Read and written by ModelXD only (service role), like the reports
-- themselves (131: revoked from public, anon and authenticated by name; new
-- columns inherit that). Reports from before have no reason. Additive; safe
-- to re-run. Run by hand. Dev and prod share this database.

begin;

alter table public.xsports_room_reports
  add column if not exists reason  text,
  add column if not exists details text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'xsports_room_reports_reason_check') then
    alter table public.xsports_room_reports add constraint xsports_room_reports_reason_check
      check (reason is null or reason in ('spam', 'harassment', 'hate', 'sexual', 'misinfo', 'wrong', 'inappropriate', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'xsports_room_reports_details_check') then
    alter table public.xsports_room_reports add constraint xsports_room_reports_details_check
      check (details is null or length(details) <= 500);
  end if;
end $$;

commit;

-- Check after running (publishable key; both must still be refused):
--   GET  /rest/v1/xsports_room_reports?select=reason&limit=1   → 401/42501
--   POST /rest/v1/xsports_room_reports                         → 401/42501
-- and with the service key a report row with reason 'spam' saves, one with
-- reason 'nonsense' is refused (23514).
