// Disposable in-memory Postgres (PGlite) with a minimal Supabase bootstrap and the repo's
// migrations applied in order. Shared by the supabase/tests/*.pglite.test.* files (`npm run
// test:db`); never connects to a real database. PGlite is the project's devDependency
// (@electric-sql/pglite); BREJAMAP_PGLITE_DIR may point to another install to try a version.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
export const PGLITE_DIR = process.env.BREJAMAP_PGLITE_DIR;
/** Kept for the test files' `{ skip }` option: the tests always run (they fail if PGlite is missing). */
export const SKIP_REASON = false;
export const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

export const USER_A = "00000000-0000-4000-8000-00000000000a";
export const USER_B = "00000000-0000-4000-8000-00000000000b";

export const SUPABASE_BOOTSTRAP = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
insert into auth.users (id, email) values
  ('${USER_A}', 'a@example.test'),
  ('${USER_B}', 'b@example.test');
`;

export function readMigration(file) {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

/** New database with the bootstrap and the first `count` migrations (all by default). */
export async function openMigratedDb(count = migrationFiles.length) {
  const { PGlite } = PGLITE_DIR
    ? await import(pathToFileURL(createRequire(join(PGLITE_DIR, "package.json")).resolve("@electric-sql/pglite")).href)
    : await import("@electric-sql/pglite");
  const db = await PGlite.create();
  await db.exec(SUPABASE_BOOTSTRAP);
  for (const file of migrationFiles.slice(0, count)) {
    try {
      await db.exec(readMigration(file));
    } catch (e) {
      throw new Error(`migration ${file} failed: ${e.message}`);
    }
  }
  return db;
}

/** Runs fn as a Supabase role (with JWT claims), then resets to the superuser. */
export async function asRole(db, role, sub, fn) {
  const claims = JSON.stringify(sub ? { sub, role } : { role });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}
