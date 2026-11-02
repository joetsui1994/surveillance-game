-- Surveillance Game: multiplayer schema. Paste into the Supabase SQL editor and run (safe to re-run).
-- Then set the presenter PIN once:  select set_presenter_pin('your-pin');
-- After a dry run, start fresh with:  truncate rounds, plays restart identity;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rounds (
  id bigint generated always as identity primary key,
  number int not null unique,
  preset_id text not null,
  outbreak_id text not null,
  budget int not null check (budget between 1 and 100),
  rank_metric text not null default 'auc' check (rank_metric in ('auc', 'lc_auc', 'accuracy')),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
-- At most one open round.
create unique index if not exists rounds_one_open on public.rounds ((true)) where status = 'open';

create table if not exists public.plays (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.rounds (id) on delete cascade,
  preset_id text not null,
  outbreak_id text not null,
  budget int not null,
  player_id uuid not null,
  nickname text not null,
  picks int[] not null,
  used_predictions boolean not null default false,
  used_uncertainty boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);

-- Hashed presenter PIN; no policies, so the public (anon) key can never read it.
create table if not exists public.presenter_secret (
  id int primary key default 1 check (id = 1),
  pin_hash text not null
);

-- The public key may only read rounds and plays. All writes go through the functions below.
alter table public.rounds enable row level security;
alter table public.plays enable row level security;
alter table public.presenter_secret enable row level security;
revoke all on public.rounds, public.plays, public.presenter_secret from anon, authenticated;
grant select on public.rounds, public.plays to anon, authenticated;
drop policy if exists "rounds are public" on public.rounds;
create policy "rounds are public" on public.rounds for select to anon, authenticated using (true);
drop policy if exists "plays are public" on public.plays;
create policy "plays are public" on public.plays for select to anon, authenticated using (true);

create or replace function public.pin_ok(pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from presenter_secret where pin_hash = crypt(pin, pin_hash));
$$;

create or replace function public.require_pin(pin text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not pin_ok(pin) then raise exception 'wrong_pin'; end if;
end $$;

create or replace function public.check_pin(pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select pin_ok(pin);
$$;

create or replace function public.set_presenter_pin(new_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if char_length(coalesce(new_pin, '')) < 6 then raise exception 'PIN must be at least 6 characters'; end if;
  insert into presenter_secret (id, pin_hash) values (1, crypt(new_pin, gen_salt('bf')))
  on conflict (id) do update set pin_hash = excluded.pin_hash;
end $$;

create or replace function public.open_round(pin text, p_preset_id text, p_outbreak_id text, p_budget int, p_rank_metric text)
returns public.rounds
language plpgsql security definer set search_path = public, extensions as $$
declare r rounds;
begin
  perform require_pin(pin);
  update rounds set status = 'closed', closed_at = now() where status = 'open';
  insert into rounds (number, preset_id, outbreak_id, budget, rank_metric)
  values ((select coalesce(max(number), 0) + 1 from rounds), p_preset_id, p_outbreak_id, p_budget, p_rank_metric)
  returning * into r;
  return r;
end $$;

create or replace function public.close_round(pin text, p_round_id bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(pin);
  update rounds set status = 'closed', closed_at = now() where id = p_round_id and status = 'open';
end $$;

create or replace function public.hide_play(pin text, p_play_id bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(pin);
  update plays set hidden = true where id = p_play_id;
end $$;

-- A finished round game. Errors (matched by the app): round_closed, invalid, duplicate.
create or replace function public.submit_play(
  p_round_id bigint, p_preset_id text, p_outbreak_id text, p_budget int, p_player_id uuid,
  p_nickname text, p_picks int[], p_used_predictions boolean, p_used_uncertainty boolean
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r rounds;
begin
  -- Lock the round row so a concurrent close_round can't slip in between the check and the insert.
  select * into r from rounds where id = p_round_id for share;
  if not found or r.status <> 'open' then raise exception 'round_closed'; end if;
  if p_preset_id is distinct from r.preset_id or p_outbreak_id is distinct from r.outbreak_id or p_budget is distinct from r.budget
     or coalesce(cardinality(p_picks), 0) <> r.budget
     or (select count(distinct x) from unnest(p_picks) as x where x >= 0) <> r.budget
     or char_length(btrim(coalesce(p_nickname, ''))) not between 1 and 24
  then
    raise exception 'invalid';
  end if;
  insert into plays (round_id, preset_id, outbreak_id, budget, player_id, nickname, picks, used_predictions, used_uncertainty)
  values (p_round_id, p_preset_id, p_outbreak_id, p_budget, p_player_id, btrim(p_nickname), p_picks,
          coalesce(p_used_predictions, false), coalesce(p_used_uncertainty, false));
exception when unique_violation then
  raise exception 'duplicate';
end $$;

revoke all on function public.pin_ok(text), public.require_pin(text), public.set_presenter_pin(text) from public, anon, authenticated;
revoke all on function public.check_pin(text), public.open_round(text, text, text, int, text), public.close_round(text, bigint),
  public.hide_play(text, bigint), public.submit_play(bigint, text, text, int, uuid, text, int[], boolean, boolean) from public;
grant execute on function public.check_pin(text), public.open_round(text, text, text, int, text), public.close_round(text, bigint),
  public.hide_play(text, bigint), public.submit_play(bigint, text, text, int, uuid, text, int[], boolean, boolean) to anon, authenticated;

-- Live updates for the app.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rounds') then
    alter publication supabase_realtime add table public.rounds;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'plays') then
    alter publication supabase_realtime add table public.plays;
  end if;
end $$;
