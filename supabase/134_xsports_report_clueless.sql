-- supabase/134_xsports_report_clueless.sql — one more reason to report the
-- AI commentator in an X體育 room: 不懂球, it doesn't know the game (owner,
-- Oct 14: "在檢舉裡面要多一個選項。不懂球....之類的").
--
--   xsports_room_reports.reason   adds 'clueless' to 133's list
--
-- 133 named its check xsports_room_reports_reason_check (this table was
-- never renamed, so the name is its own); it is dropped and made again with
-- the wider list. Reports stay readable and writable by ModelXD only. Safe to
-- re-run. Run by hand. Dev and prod share this database. Until it runs, the
-- page's 不懂球 reports are saved as 'other' with "[clueless]" in front of
-- their details (lib/xsports-room.ts report()).

begin;

alter table public.xsports_room_reports drop constraint if exists xsports_room_reports_reason_check;
alter table public.xsports_room_reports add constraint xsports_room_reports_reason_check
  check (reason is null or reason in ('spam', 'harassment', 'hate', 'sexual', 'misinfo', 'wrong', 'clueless', 'inappropriate', 'other'));

commit;

-- Check after running (service key, nothing stored): a report row with
-- reason 'clueless' and made-up ids gets 23503 (the check passed, the
-- message does not exist); reason 'nonsense' still gets 23514.
