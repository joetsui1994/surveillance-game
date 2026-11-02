-- Minimal stand-ins for what a Supabase project already has, so schema.sql can be tested on plain Postgres.
create role anon nologin; create role authenticated nologin;
create schema extensions; grant usage on schema extensions to anon, authenticated;
create publication supabase_realtime;
grant usage on schema public to anon, authenticated;
-- Supabase default: broad grants to API roles (schema.sql must revoke them)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
