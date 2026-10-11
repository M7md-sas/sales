-- ============================================================
--  SHOP DAILY SALES — COMPLETE SUPABASE SCHEMA
--  Version 4.1  (v4.0 from the build guide + the fixes in DEVIATIONS.md)
--
--  Worker uploads a PHOTO ONLY. Gemini extracts the figures.
--  Owner reviews/approves every entry before it counts as final.
--  Worker account remains WRITE-ONLY: it can retrieve nothing.
--
--  Run once, top to bottom, in the SQL Editor. Safe to re-run.
--
--  Every change from the v4.0 script in Appendix A is marked  [4.1]
--  and explained in docs/DEVIATIONS.md. Changes made after the
--  four-reviewer audit are marked [4.2] (DEVIATIONS.md, section 9+).
-- ============================================================

-- ---------- 1. ENUM TYPES ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('owner', 'worker');
  end if;
  if not exists (select 1 from pg_type where typname = 'entry_status') then
    -- pending_extraction : photo received, Gemini has not returned yet
    -- needs_review       : Gemini returned (or failed) — owner must check
    -- approved           : owner has confirmed the figures are correct
    create type public.entry_status as enum
      ('pending_extraction', 'needs_review', 'approved');
  end if;
  if not exists (select 1 from pg_type where typname = 'entry_source') then
    -- worker_upload : came in through the normal daily flow
    -- owner_import  : typed/uploaded by the owner from the historical backlog
    create type public.entry_source as enum ('worker_upload', 'owner_import');
  end if;
end $$;


-- ---------- 2. TABLES ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role         public.user_role not null default 'worker',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.daily_entries (
  id                uuid primary key default gen_random_uuid(),
  entry_date        date not null unique,

  -- FINAL figures — what the owner has confirmed. Null until reviewed.
  cash_total        numeric(10,2) check (cash_total is null or (cash_total >= 0 and cash_total <= 999999.99)),
  mada_total        numeric(10,2) check (mada_total is null or (mada_total >= 0 and mada_total <= 999999.99)),
  total             numeric(10,2) generated always as (coalesce(cash_total,0) + coalesce(mada_total,0)) stored,
  customer_count    integer check (customer_count is null or (customer_count >= 0 and customer_count <= 999)),

  -- RAW figures returned by Gemini, kept forever even after the owner edits.
  -- This is what lets you tell, a year later, whether the model or the
  -- owner's correction was the one that was wrong.
  extracted_cash     numeric(10,2),
  extracted_mada     numeric(10,2),
  extracted_customers integer,
  extraction_confidence numeric(3,2),   -- 0.00 to 1.00, from the model
  extraction_error   text,              -- set if Gemini failed or the photo was unreadable

  photo_path        text not null,
  notes              text,
  status             public.entry_status not null default 'pending_extraction',
  source             public.entry_source not null default 'worker_upload',
  revision           integer not null default 1,

  submitted_by       uuid references auth.users (id) on delete set null,
  submitted_at       timestamptz not null default now(),
  reviewed_by        uuid references auth.users (id) on delete set null,
  reviewed_at        timestamptz,
  updated_at         timestamptz not null default now()
);

create index if not exists daily_entries_date_idx   on public.daily_entries (entry_date desc);
create index if not exists daily_entries_status_idx on public.daily_entries (status) where status <> 'approved';

create table if not exists public.settings (
  key   text primary key,
  value text not null
);

insert into public.settings (key, value) values
  ('monthly_target', '3000'),
  ('shop_name',      'المحل'),
  ('currency',       'SAR'),
  ('timezone',       'Asia/Riyadh')
on conflict (key) do nothing;

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid references auth.users (id) on delete set null,
  action     text not null,
  entry_date date,
  detail     jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);


-- ---------- 3. HELPER FUNCTIONS ----------
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and active = true
  );
$$;

-- The business day runs midnight to midnight, Riyadh time, decided on the
-- server's clock. [4.2] The client confirmed the 24-hour day closing at 12
-- at night (DEVIATIONS.md #9); the phone's clock never decides it.
create or replace function public.today_riyadh()
returns date
language sql stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;

-- [4.2] An active worker or owner. Deactivating a profile now actually stops
-- that account from submitting or uploading (DEVIATIONS.md #14).
create or replace function public.is_active_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true and role in ('worker', 'owner')
  );
$$;


-- ---------- 4. ROW LEVEL SECURITY ----------
alter table public.profiles      enable row level security;
alter table public.daily_entries enable row level security;
alter table public.settings      enable row level security;
alter table public.audit_log     enable row level security;

drop policy if exists "p_read_own"  on public.profiles;
drop policy if exists "p_owner_all" on public.profiles;
create policy "p_read_own"  on public.profiles for select using (id = auth.uid());
create policy "p_owner_all" on public.profiles for all
  using (public.is_owner()) with check (public.is_owner());

-- Owner: READ access. Worker: NO policy at all -> no access at all.
-- His only door in is submit_photo() below, and it returns no data.
--
-- [4.2] The owner no longer writes to this table directly either. Every
-- change goes through a function that checks the row's state and writes the
-- audit log — so "approved is final" holds even against a stolen owner
-- session, not only in the UI (DEVIATIONS.md #13).
drop policy if exists "e_owner_all"     on public.daily_entries;
drop policy if exists "e_owner_read"    on public.daily_entries;
drop policy if exists "e_worker_recent" on public.daily_entries;
create policy "e_owner_read" on public.daily_entries for select
  using (public.is_owner());

drop policy if exists "s_owner_all" on public.settings;
create policy "s_owner_all" on public.settings for all
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "a_owner_read" on public.audit_log;
create policy "a_owner_read" on public.audit_log for select using (public.is_owner());


-- ---------- 5. WORKER ENTRY POINT ----------
-- The ONLY thing the worker's app calls. He supplies a photo path
-- (already uploaded to storage) and nothing else but an optional
-- note. No totals pass through his hands in either direction.
--
-- [4.2] p_entry_date may be null: the live send passes null and the server
-- decides the day from its own clock. Only a photo that waited in the
-- offline queue carries the day it was taken. A date ahead of the server's
-- (a phone clock a few minutes fast at midnight) is pulled back to today
-- instead of being refused and silently dropped (DEVIATIONS.md #9).
drop function if exists public.submit_photo(date, text, text);
create or replace function public.submit_photo(
  p_entry_date date,
  p_photo_path text,
  p_notes      text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_today    date := public.today_riyadh();
  v_date     date := least(coalesce(p_entry_date, public.today_riyadh()), public.today_riyadh());
  v_existing public.daily_entries%rowtype;
  v_uid      uuid := auth.uid();
begin
  if v_uid is null then
    return json_build_object('ok', false, 'code', 'not_signed_in');
  end if;

  -- [4.2] A deactivated account, or one that is neither worker nor owner
  -- (a self-registered account if sign-ups were ever left open), gets nothing.
  if not public.is_active_member() then
    return json_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_date < v_today - 7 then
    return json_build_object('ok', false, 'code', 'bad_date');
  end if;

  if p_photo_path is null or length(trim(p_photo_path)) = 0 then
    return json_build_object('ok', false, 'code', 'photo_required');
  end if;

  -- [4.2] The path must be a photo this same account really uploaded. Before
  -- this, any string was accepted — a path that did not exist, a file someone
  -- else uploaded, or a text file posing as a photo (DEVIATIONS.md #12).
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'receipts'
      and name = p_photo_path
      and owner_id = v_uid::text
  ) then
    return json_build_object('ok', false, 'code', 'photo_required');
  end if;

  select * into v_existing from daily_entries where entry_date = v_date;

  if found then
    if v_existing.status = 'approved' then
      return json_build_object('ok', false, 'code', 'locked');
    end if;

    -- [4.2] Each re-send costs a reading on the free Gemini tier. Ten a day
    -- is far beyond honest retakes and stops anyone burning the quota.
    if v_existing.revision >= 10 then
      return json_build_object('ok', false, 'code', 'too_many');
    end if;

    insert into audit_log (actor, action, entry_date, detail)
    values (v_uid, 'replace', v_date, to_jsonb(v_existing));

    update daily_entries set
      photo_path      = p_photo_path,
      notes           = p_notes,
      status          = 'pending_extraction',
      cash_total      = null, mada_total = null, customer_count = null,
      extracted_cash  = null, extracted_mada = null, extracted_customers = null,
      extraction_confidence = null, extraction_error = null,
      revision        = v_existing.revision + 1,
      submitted_by    = v_uid,
      submitted_at    = now(),
      updated_at      = now()
    where entry_date = v_date;

    -- Same reply as a first submission — he cannot learn a row existed.
    return json_build_object('ok', true, 'code', 'saved');
  end if;

  -- [4.2] Two sends of the same new day racing each other (a double tap
  -- while the queue flushes) no longer end in a unique-violation error.
  insert into daily_entries (entry_date, photo_path, notes, submitted_by)
  values (v_date, p_photo_path, p_notes, v_uid)
  on conflict (entry_date) do nothing;

  if found then
    insert into audit_log (actor, action, entry_date)
    values (v_uid, 'create', v_date);
  end if;

  return json_build_object('ok', true, 'code', 'saved');
end;
$$;


-- ---------- 6. EXTRACTION CALLBACK ----------
-- Called by the Edge Function after Gemini returns. Runs with the
-- service_role key, server-side only — never called from either phone app.
--
-- [4.2] p_photo_path is the photo that was actually read. The write lands
-- only if the row still holds that same photo. Without it, a slow reading of
-- a photo the worker has since replaced was written next to the new photo,
-- and the new photo's own reading was then refused (DEVIATIONS.md #11).
drop function if exists public.record_extraction(date, numeric, numeric, integer, numeric, text);
create or replace function public.record_extraction(
  p_entry_date  date,
  p_photo_path  text,
  p_cash        numeric,
  p_mada        numeric,
  p_customers   integer,
  p_confidence  numeric,
  p_error       text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
begin
  update daily_entries set
    extracted_cash        = p_cash,
    extracted_mada        = p_mada,
    extracted_customers   = p_customers,
    extraction_confidence = p_confidence,
    extraction_error      = p_error,
    -- Pre-fill the working figures with the model's answer so the
    -- owner's review screen opens already populated. He is correcting,
    -- not typing from a blank screen. A column the model could not read
    -- stays empty rather than becoming a confident zero.
    cash_total     = p_cash,
    mada_total     = p_mada,
    customer_count = p_customers,
    status         = 'needs_review',
    updated_at     = now()
  where entry_date = p_entry_date
    and photo_path = p_photo_path
    -- [4.1] Only a row still awaiting its reading may be written to.
    -- Without this, a late or duplicated webhook delivery could overwrite
    -- figures the owner had already approved. Approving is final; the
    -- pipeline must not be able to undo it.
    and status = 'pending_extraction';

  return json_build_object('ok', found);
end;
$$;


-- ---------- 7. OWNER ACTIONS ----------
-- [4.2] p_revision is the revision the owner was looking at. If the worker
-- re-sent the day while the card was open, the revision has moved on and the
-- approval is refused as 'stale' instead of pairing the old figures with the
-- new photo (DEVIATIONS.md #11). Null skips the check, for callers that are
-- not a review card.
drop function if exists public.approve_day(date, numeric, numeric, integer);
create or replace function public.approve_day(
  p_entry_date date,
  p_cash       numeric,
  p_mada       numeric,
  p_customer_count integer,
  p_revision   integer default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_before public.daily_entries%rowtype;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_cash is null or p_mada is null or p_cash < 0 or p_mada < 0
     or p_cash > 999999.99 or p_mada > 999999.99 then
    return json_build_object('ok', false, 'code', 'bad_amount');
  end if;
  if p_customer_count is not null and (p_customer_count < 0 or p_customer_count > 999) then
    return json_build_object('ok', false, 'code', 'bad_amount');
  end if;

  select * into v_before from daily_entries where entry_date = p_entry_date for update;
  if not found then
    return json_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_revision is not null and v_before.revision <> p_revision then
    return json_build_object('ok', false, 'code', 'stale');
  end if;

  update daily_entries set
    cash_total     = p_cash,
    mada_total     = p_mada,
    customer_count = coalesce(p_customer_count, 0),
    status         = 'approved',
    reviewed_by    = auth.uid(),
    reviewed_at    = now(),
    updated_at     = now()
  where entry_date = p_entry_date;

  -- [4.2] A correction of an approved day keeps the figures it replaced.
  insert into audit_log (actor, action, entry_date, detail)
  values (auth.uid(),
          case when v_before.status = 'approved' then 'correct' else 'approve' end,
          p_entry_date,
          jsonb_build_object(
            'before', jsonb_build_object('cash', v_before.cash_total, 'mada', v_before.mada_total,
                                         'customers', v_before.customer_count,
                                         'status', v_before.status),
            'after',  jsonb_build_object('cash', p_cash, 'mada', p_mada,
                                         'customers', coalesce(p_customer_count, 0))));

  return json_build_object('ok', true);
end;
$$;

-- [4.2] Send a day back through the reading step — the way out of a failed
-- or never-finished reading (quota hit, model busy, webhook lost). The UPDATE
-- itself fires the webhook. Approved days are final and are refused.
create or replace function public.retry_extraction(p_entry_date date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.daily_entries%rowtype;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into v_row from daily_entries where entry_date = p_entry_date for update;
  if not found then
    return json_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.status = 'approved' then
    return json_build_object('ok', false, 'code', 'locked');
  end if;
  if v_row.photo_path is null or v_row.photo_path = 'none' then
    return json_build_object('ok', false, 'code', 'no_photo');
  end if;

  update daily_entries set
    status = 'pending_extraction',
    cash_total = null, mada_total = null, customer_count = null,
    extracted_cash = null, extracted_mada = null, extracted_customers = null,
    extraction_confidence = null, extraction_error = null,
    updated_at = now()
  where entry_date = p_entry_date;

  insert into audit_log (actor, action, entry_date)
  values (auth.uid(), 'retry_extraction', p_entry_date);

  return json_build_object('ok', true);
end;
$$;

-- [4.2] Move an unapproved day to the date it really belongs to — for a page
-- sent after midnight, or from a phone with a wrong clock. Only into an empty
-- date, so nothing is ever overwritten by it (DEVIATIONS.md #9).
create or replace function public.move_day(p_from date, p_to date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.daily_entries%rowtype;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_to is null or p_to > public.today_riyadh() then
    return json_build_object('ok', false, 'code', 'bad_date');
  end if;

  select * into v_row from daily_entries where entry_date = p_from for update;
  if not found then
    return json_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.status = 'approved' then
    return json_build_object('ok', false, 'code', 'locked');
  end if;
  if exists (select 1 from daily_entries where entry_date = p_to) then
    return json_build_object('ok', false, 'code', 'date_taken');
  end if;

  update daily_entries set entry_date = p_to, updated_at = now()
  where entry_date = p_from;

  insert into audit_log (actor, action, entry_date, detail)
  values (auth.uid(), 'move', p_to, jsonb_build_object('from', p_from, 'to', p_to)),
         (auth.uid(), 'move', p_from, jsonb_build_object('from', p_from, 'to', p_to));

  return json_build_object('ok', true);
end;
$$;

-- Historical backfill / bulk import. No 7-day limit. Used for both
-- the one-by-one "add old day" screen and the bulk photo importer.
create or replace function public.owner_import_day(
  p_entry_date date,
  p_photo_path text default null,
  p_cash       numeric default null,
  p_mada       numeric default null,
  p_customer_count integer default null,
  p_notes      text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_status public.entry_status;
  v_existing public.daily_entries%rowtype;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_entry_date > public.today_riyadh() then
    return json_build_object('ok', false, 'code', 'bad_date');
  end if;

  -- [4.2] An approved day is final. Importing over it used to send it back to
  -- "still reading" without a word; a correction goes through the review
  -- card instead, where the audit log records it (DEVIATIONS.md #15).
  select * into v_existing from daily_entries where entry_date = p_entry_date for update;
  if found and v_existing.status = 'approved' then
    return json_build_object('ok', false, 'code', 'locked');
  end if;

  v_status := case when p_cash is not null and p_mada is not null
                   then 'approved' else 'pending_extraction' end;

  insert into daily_entries
    (entry_date, photo_path, cash_total, mada_total, customer_count,
     notes, status, source, submitted_by, reviewed_by, reviewed_at)
  values
    (p_entry_date, coalesce(p_photo_path, 'none'), p_cash, p_mada, p_customer_count,
     p_notes, v_status, 'owner_import', auth.uid(),
     case when v_status = 'approved' then auth.uid() end,
     case when v_status = 'approved' then now() end)
  on conflict (entry_date) do update set
    -- [4.2] A figures-only import keeps the photo already on the row instead
    -- of replacing a real path with 'none'.
    photo_path     = coalesce(p_photo_path, daily_entries.photo_path),
    -- [4.2] DEVIATIONS #6 cleared extracted_* but kept the working figures,
    -- so a failed re-read showed the old photo's numbers next to the new
    -- photo. A day going back to extraction now starts from empty fields.
    cash_total     = case when excluded.status = 'pending_extraction' then null
                          else excluded.cash_total end,
    mada_total     = case when excluded.status = 'pending_extraction' then null
                          else excluded.mada_total end,
    customer_count = case when excluded.status = 'pending_extraction' then null
                          else excluded.customer_count end,
    notes          = coalesce(excluded.notes, daily_entries.notes),
    status         = excluded.status,
    revision       = daily_entries.revision + 1,
    -- [4.1] Re-importing a photo sends the row back through extraction, so
    -- the previous reading and its confidence score must not survive into
    -- the new review card. Without this the owner sees "clear reading, 0.96"
    -- next to figures produced from a different photograph.
    extracted_cash        = case when excluded.status = 'pending_extraction'
                                 then null else daily_entries.extracted_cash end,
    extracted_mada        = case when excluded.status = 'pending_extraction'
                                 then null else daily_entries.extracted_mada end,
    extracted_customers   = case when excluded.status = 'pending_extraction'
                                 then null else daily_entries.extracted_customers end,
    extraction_confidence = case when excluded.status = 'pending_extraction'
                                 then null else daily_entries.extraction_confidence end,
    extraction_error      = case when excluded.status = 'pending_extraction'
                                 then null else daily_entries.extraction_error end,
    reviewed_by    = excluded.reviewed_by,
    reviewed_at    = excluded.reviewed_at,
    updated_at     = now();

  insert into audit_log (actor, action, entry_date)
  values (auth.uid(), 'owner_import', p_entry_date);

  return json_build_object('ok', true, 'status', v_status);
end;
$$;

create or replace function public.get_monthly(p_year integer)
returns table (
  month_start   date,
  days_recorded bigint,
  cash_total    numeric,
  mada_total    numeric,
  grand_total   numeric,
  customers     bigint,
  avg_per_day   numeric
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'forbidden';
  end if;

  return query
  select date_trunc('month', e.entry_date)::date,
         count(*),
         sum(e.cash_total), sum(e.mada_total), sum(e.total),
         sum(e.customer_count)::bigint, round(avg(e.total), 2)
  from daily_entries e
  where extract(year from e.entry_date) = p_year
    and e.status = 'approved'
  group by 1
  order by 1;
end;
$$;

-- Rolling 7-day average and same-weekday comparison, used on the
-- Today screen instead of a daily target.
create or replace function public.get_trend(p_entry_date date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_avg7    numeric;
  v_weekday_avg numeric;
begin
  if not public.is_owner() then
    raise exception 'forbidden';
  end if;

  select round(avg(total), 2) into v_avg7
  from daily_entries
  where status = 'approved'
    and entry_date between p_entry_date - 7 and p_entry_date - 1;

  select round(avg(total), 2) into v_weekday_avg
  from daily_entries
  where status = 'approved'
    and entry_date < p_entry_date
    and extract(dow from entry_date) = extract(dow from p_entry_date)
    and entry_date >= p_entry_date - 56;   -- last 8 occurrences of that weekday

  return json_build_object(
    'avg_last_7_days', v_avg7,
    'avg_same_weekday_last_8', v_weekday_avg
  );
end;
$$;

-- [4.1] Used by the set-worker-code Edge Function to find the worker's
-- account without giving the browser any way to enumerate users. It returns
-- one id and only to the owner.
create or replace function public.worker_user_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.profiles
  where role = 'worker' and active = true
  order by created_at
  limit 1;
$$;


-- [4.2] How much of the free tier's 1 GB the photographs use, for the
-- Settings screen. Owner only.
create or replace function public.storage_usage()
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_bytes bigint;
  v_count bigint;
begin
  if not public.is_owner() then
    return json_build_object('ok', false, 'code', 'forbidden');
  end if;
  select coalesce(sum((metadata->>'size')::bigint), 0), count(*)
    into v_bytes, v_count
  from storage.objects where bucket_id = 'receipts';
  return json_build_object('ok', true, 'bytes', v_bytes, 'files', v_count);
end;
$$;

-- [4.2] Ends every session of one account. Used by set-worker-code so that a
-- changed worker password actually locks the previous worker out, instead of
-- leaving his phone signed in for as long as its refresh token lives.
-- Edge Function only (service_role).
create or replace function public.end_user_sessions(p_user uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from auth.sessions where user_id = p_user;
$$;


-- ---------- 8. GRANTS ----------
grant usage on schema public to authenticated;

-- [4.2] Supabase grants ALL on every new table to anon and authenticated by
-- default. Writes to daily_entries and audit_log now happen only inside the
-- functions above, so the table grants are taken back to read-only.
revoke all on public.daily_entries, public.profiles, public.audit_log from authenticated;
grant select on public.daily_entries to authenticated;
grant select on public.profiles to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- [4.2] Nothing in this project is meant for a caller who is not signed in.
-- Supabase also grants EXECUTE on new functions to anon by default; take all
-- of it back, then grant the signed-in apps exactly what they use.
revoke execute on all functions in schema public from public, anon;

grant execute on function public.submit_photo(date, text, text)                         to authenticated;
grant execute on function public.approve_day(date, numeric, numeric, integer, integer)  to authenticated;
grant execute on function public.retry_extraction(date)                                  to authenticated;
grant execute on function public.move_day(date, date)                                    to authenticated;
grant execute on function public.storage_usage()                                         to authenticated;
grant execute on function public.owner_import_day(date, text, numeric, numeric, integer, text) to authenticated;
grant execute on function public.get_monthly(integer)                                    to authenticated;
grant execute on function public.get_trend(date)                                         to authenticated;
grant execute on function public.is_owner()                                              to authenticated;
grant execute on function public.is_active_member()                                      to authenticated;
grant execute on function public.today_riyadh()                                          to authenticated;

-- record_extraction is called ONLY by the Edge Function with the
-- service_role key, which bypasses grants entirely.
--
-- [4.1] SECURITY FIX — this is the important one.
--
-- The v4.0 script simply omits record_extraction from the grant list and
-- notes "do not grant it to authenticated". That is not enough: PostgreSQL
-- grants EXECUTE on every new function to PUBLIC by default, and both anon
-- and authenticated inherit it. As written, the worker's own account could
-- call record_extraction over PostgREST and write any figures it liked into
-- any date — the one thing this whole design exists to prevent, and the
-- exact case acceptance test 11.1 claims to cover.
--
-- Revoking from PUBLIC is what actually closes it. Revoking from anon and
-- authenticated alone would leave the inherited PUBLIC grant in place.
revoke execute on function public.record_extraction(date, text, numeric, numeric, integer, numeric, text)
  from public, anon, authenticated;

-- Same reasoning: these two are for the Edge Functions only.
revoke execute on function public.worker_user_id()         from public, anon, authenticated;
revoke execute on function public.end_user_sessions(uuid)  from public, anon, authenticated;

revoke all on public.daily_entries, public.profiles, public.settings, public.audit_log from anon;


-- ---------- 9. STORAGE ----------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- [4.2] Enforced by Storage itself, not by the phone: JPEG only, 2 MB at
-- most. The app compresses to ~300 KB; anything bigger is not a notebook
-- photo, and without a ceiling one account could fill the free 1 GB
-- (DEVIATIONS.md #12).
update storage.buckets
set public = false,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg']
where id = 'receipts';

-- [4.2] Uploads only from an active worker/owner, only under the two name
-- shapes the apps produce, and the historical folder for the owner alone.
drop policy if exists "st_upload" on storage.objects;
create policy "st_upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_active_member()
    and (
      name ~ '^\d{4}-\d{2}-\d{2}_\d{10,16}\.jpg$'
      or (name ~ '^backfill/\d{4}-\d{2}-\d{2}_\d{10,16}\.jpg$' and public.is_owner())
    )
  );

drop policy if exists "st_owner_read" on storage.objects;
create policy "st_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_owner());


-- ============================================================
--  NEXT STEPS — see docs/الإعداد-خطوة-بخطوة.md for the full walkthrough.
--
--  1. Create the two users in Authentication > Users, then run
--     (with the real UUIDs):
--
--       insert into public.profiles (id, display_name, role) values
--         ('OWNER-UUID-HERE',  'المالك', 'owner'),
--         ('WORKER-UUID-HERE', 'العامل', 'worker');
--
--  2. Deploy both Edge Functions and set the secrets:
--
--       supabase functions deploy extract-figures --no-verify-jwt
--       supabase functions deploy set-worker-code
--       supabase secrets set GEMINI_API_KEY=your-key-here
--       supabase secrets set WEBHOOK_SECRET=<long random string>
--
--  3. Wire a Database Webhook on daily_entries:
--
--       Events: Insert AND Update      <-- [4.1] the guide says Insert only.
--                                          Re-submitting a day is an UPDATE,
--                                          so extraction would never re-run.
--       Type:   Supabase Edge Function -> extract-figures
--       HTTP header:  x-webhook-secret = the same WEBHOOK_SECRET   <-- [4.2]
--
--     No condition is needed: the function reads the row itself and ignores
--     any row that is not pending_extraction, which also stops it looping on
--     its own write. Without the header it refuses every call.
-- ============================================================
