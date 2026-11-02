-- Behaviour checks for schema.sql, run as the public (anon) role. Any failed check aborts with an error.
\set ON_ERROR_STOP on
select set_presenter_pin('secret-pin-1');

-- expect_error(sql, message): run sql and require it to fail with exactly that message.
create function pg_temp.expect_error(stmt text, msg text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected error "%" from: %', msg, stmt using errcode = 'P0002';
exception
  when sqlstate 'P0002' then raise;
  when others then
    if sqlerrm not like msg then raise exception 'expected error "%", got "%" from: %', msg, sqlerrm, stmt; end if;
end $$;

-- expect(condition, label)
create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'check failed: %', label; end if;
end $$;

select pg_temp.expect_error($q$select set_presenter_pin('123456789')$q$, 'PIN must be at least 10 characters');

set role anon;

select pg_temp.expect_error('select * from presenter_secret', 'permission denied%');
select pg_temp.expect_error($q$insert into plays (round_id, preset_id, outbreak_id, budget, player_id, nickname, picks) values (1, 'g', 'o', 1, gen_random_uuid(), 'x', '{1}')$q$, 'permission denied%');
select pg_temp.expect_error($q$update rounds set status = 'open'$q$, 'permission denied%');
select pg_temp.expect_error($q$select set_presenter_pin('hacked-pin')$q$, 'permission denied%');

select pg_temp.expect(not check_pin('nope') and check_pin('secret-pin-1'), 'check_pin');
select pg_temp.expect_error($q$select open_round('nope', 'grid10', 'ob00', 3, 'auc')$q$, 'wrong_pin');

select open_round('secret-pin-1', 'grid10', 'ob00', 3, 'auc');
select pg_temp.expect_error($q$select open_round('secret-pin-1', 'grid10', 'ob01', 3, 'auc')$q$, 'round_open');
select close_round('secret-pin-1', 1);
select open_round('secret-pin-1', 'grid10', 'ob01', 3, 'auc');
select pg_temp.expect((select array_agg(status order by number) from rounds) = '{closed,open}', 'a round opens only once the previous one is closed');
select pg_temp.expect((select array_agg(number order by id) from rounds) = '{1,2}', 'rounds are numbered in order');

select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000001', ' ada ', '{1,2,3}', true, false);
select pg_temp.expect((select nickname = 'ada' and used_predictions from plays where round_id = 2), 'valid play stored, nickname trimmed');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000001', 'ada', '{4,5,6}', true, false)$q$, 'duplicate');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 4, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3,4}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,1,2}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,null,2}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,-2,3}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{{1},{2},{3}}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob00', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', '  ', '{1,2,3}', true, false)$q$, 'invalid');
select pg_temp.expect_error($q$select submit_play(1, 'grid10', 'ob00', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3}', true, false)$q$, 'round_closed');

select pg_temp.expect_error($q$select close_round('nope', 2)$q$, 'wrong_pin');
select close_round('secret-pin-1', 2);
select pg_temp.expect_error($q$select submit_play(2, 'grid10', 'ob01', 3, '00000000-0000-0000-0000-000000000002', 'bob', '{1,2,3}', true, false)$q$, 'round_closed');

select pg_temp.expect_error($q$select hide_play('nope', 1)$q$, 'wrong_pin');
select hide_play('secret-pin-1', (select id from plays limit 1));
select pg_temp.expect((select bool_and(hidden) from plays), 'hide_play');
select pg_temp.expect((select count(*) = 1 from plays), 'exactly one play stored');

\echo 'All schema checks passed.'
