<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->

## BrejaMap Project State & Workflow

Read this section first to resume work in a new session; keep it current when the backlog moves.

### Role & architecture

- BrejaMap is a crowdsourced map of beer prices in bars (Brazil, starting in São Carlos/SP).
- Stack: Next.js 15.5 (App Router) + React 19 + TypeScript + Tailwind CSS + Google Maps (`@react-google-maps/api`) + Supabase Postgres (project `marksrnjlviagfteprbd`).
- Production: https://brejamap.vercel.app (Vercel).
- Known limit: GET /api/venues returns at most 500 venues per bbox (priced, then user-added, then nearest to the centre) with `truncated: true` and a "zoom in" hint when the area holds more; see docs/features.md §3.1.

### Agent work assignment

- The top-level (parent) agent is an orchestrator only: it coordinates, but **all** implementation, review, research and test work is delegated to worker agents.
- Every worker agent (implementation, review, research, test, and any nested delegate) runs **Claude Opus 5.5 (`claude-opus-5-5`) with medium effort**. In T3 Code use `delegate_task` with `target.providerInstanceId: "claudeAgent"`, `target.model: "claude-opus-5-5"`, `target.options: { "effort": "medium" }`; no substitute provider, model or effort. If unavailable, stop and ask the owner.
- Pass this rule into every delegated task so nested delegates follow it too.

### Single source of truth files

- `docs/ROADMAP.md` — live checklist of completed items, current phase and prioritized backlog.
- `docs/features.md` — detailed specification of all implemented features, API contracts, DB schema and files.
- `docs/deploy.md` — deploy order (migration before merge), env vars, monitoring, OSM duplicate evidence and the manual test script.
- `supabase/migrations/001..005_*.sql` — every database migration (001–005 live in production; 005 applied on 2026-11-06).

### Repository & PR conventions

- Never push directly to `master`; always work on a feature branch and open a PR.
- Commit messages, branch names, code comments and PR titles/bodies are in **English**, with zero AI/model attribution (no model names, no `Co-Authored-By` trailers).
- User-facing UI strings and all documentation under `docs/` are in **Portuguese (pt-BR)**.
- UI preference: concise, self-explanatory controls; do not add explanatory/instructional paragraphs that repeat what labels and buttons already say.
- Run `npm run lint`, `npm run test:scripts`, `npm run test:db` and `npm run build` before pushing; all must pass with no errors or warnings. `test:db` applies every migration to an in-memory Postgres (PGlite devDependency) and must never be skipped.
- New API logic goes in `src/lib/handlers/*` (dependencies injected, plain `Response`) so it can be tested with fakes; `src/app/api/**/route.ts` files only wire the Supabase client and `process.env`.

### Current production & backlog snapshot

- Migrations `001` through `005` are live in production Supabase: RLS enabled on all tables, atomic RPC writes, Postgres fixed-window rate limits, Google + 6-digit email OTP auth configured, `USER_EDITS_ENABLED=true`, OSM venues imported for São Carlos (26 in production) and São Paulo city (`--preset sao-paulo --write` on 2026-10-29: 682 bars, no prices; a re-run inserted 0). The seed/mock bars were removed on 2026-10-29 (6 seed venues + 14 prices deleted from production; `supabase/seed.sql` and `MOCK_VENUES` deleted). Production holds 713 venues (708 OSM + 5 user-added) and 12 prices. The 4 likely duplicate OSM pairs in São Paulo are confirmed real duplicates (0–24 m, same street, no prices) and are merged at display time by GET /api/venues (no rows deleted).
- Completed: #1 Next 15 / React 19, #2 `mapHandle` bounds fix, #3 OSM import script, #4 Auth + rate limits + moderation, #5 Atomic venue/price writes, #8 Home page hooks refactor, address search ranking/formatting, price-aware map marker clustering, removal of the IP-geolocation fallback that snapped the map to São Paulo, OSM import multi-bbox presets with municipal-boundary filtering (`sao-paulo`, `sao-carlos`), Google login via Google Identity Services + `signInWithIdToken` (falls back to the OAuth redirect while `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset) the `/privacidade` privacy policy page, and dense-area handling in `GET /api/venues` (prices embedded, prioritized 500 cap, `truncated` + zoom-in hint), and the map-first "Adicionar bar" location picker (in-modal pin + explicit confirmation, opt-in device location, nearby-first optional address search, reverse-geocoded address fields).
- Live user-testing findings (2026-10-29) are tracked in docs/ROADMAP.md ("Achados do teste com usuário"). Done: redundant helper text removed, header chips wrap, P0 type + max-price on the same beer (#20), list-tab city search refresh (#21), clear-filters/active-filter count, pt-BR currency formatting, price type/freshness clarity. Full manual QA is still partial (no writes, geolocation, routes or real-device keyboard tested).
- Implemented in code, pending rollout (branch `feat/roadmap-ready-features`): per-price freshness (`updated_at`, labels, "Ainda é esse preço? Sim/Não" with `POST /api/venues/[id]/confirm`), menu photo → prices via Vercel AI Gateway (`POST /api/menu-photo`, default model `google/gemini-2.5-flash-lite`), football/reservation/outdoor-area attributes, opening hours + "Aberto agora", `/conta` with favorites, 1–5 ratings, `/admin` moderation (deny by default, `ADMIN_EMAILS`), Vercel Web Analytics + Speed Insights, display-level merge of same-name OSM entries within 25 m. Migration `005` is live in production (2026-11-06); the PR can merge once QA passes.
- Owner-dependent (not code): set `AI_GATEWAY_API_KEY`, `ADMIN_EMAILS`; add `https://brejamap.vercel.app/**` to Supabase Redirect URLs; enable Analytics/Speed Insights in the Vercel dashboard; Supabase usage alerts; custom domain; manual QA pass (docs/deploy.md §5).
- Open product decisions/partnerships: events/live music and real table booking (need bar partnerships); other drink categories (would distort the beer-price "a partir de" metric unless they become a separate category).

### Documentation maintenance

- When adding a feature, update `docs/features.md` with its behavior, UI location and main files.
- When changing existing behavior, update its corresponding specification.
- Keep `docs/README.md` as the index and register any new documents there.
- Keep documentation concise and aligned with the code.
