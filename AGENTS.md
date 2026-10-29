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

### Single source of truth files

- `docs/ROADMAP.md` — live checklist of completed items, current phase and prioritized backlog.
- `docs/features.md` — detailed specification of all implemented features, API contracts, DB schema and files.
- `supabase/migrations/001..004_*.sql` — every database migration applied in production.

### Repository & PR conventions

- Never push directly to `master`; always work on a feature branch and open a PR.
- Commit messages, branch names, code comments and PR titles/bodies are in **English**, with zero AI/model attribution (no model names, no `Co-Authored-By` trailers).
- User-facing UI strings and all documentation under `docs/` are in **Portuguese (pt-BR)**.
- Run `npm run lint`, `npm run test:scripts` and `npm run build` before pushing; all must pass with no errors or warnings.

### Current production & backlog snapshot

- Migrations `001` through `004` are live in production Supabase: RLS enabled on all tables, atomic RPC writes, Postgres fixed-window rate limits, Google + 6-digit email OTP auth configured, `USER_EDITS_ENABLED=true`, OSM venues imported for São Carlos (26 in production) and São Paulo city (`--preset sao-paulo --write` on 2026-10-29: 682 bars, no prices; a re-run inserted 0). Production holds 718 venues (708 OSM + 10 seed/user-added) and 24 prices. Follow-up: 4 likely duplicate OSM pairs in São Paulo listed in docs/ROADMAP.md.
- Completed: #1 Next 15 / React 19, #2 `mapHandle` bounds fix, #3 OSM import script, #4 Auth + rate limits + moderation, #5 Atomic venue/price writes, #8 Home page hooks refactor, address search ranking/formatting, price-aware map marker clustering, removal of the IP-geolocation fallback that snapped the map to São Paulo, OSM import multi-bbox presets with municipal-boundary filtering (`sao-paulo`, `sao-carlos`), Google login via Google Identity Services + `signInWithIdToken` (falls back to the OAuth redirect while `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset) the `/privacidade` privacy policy page, and dense-area handling in `GET /api/venues` (prices embedded, prioritized 500 cap, `truncated` + zoom-in hint).
- Next prioritized backlog:
  1. **Price freshness** — `updated_at` on prices, "atualizado há X dias" label and an "Ainda é esse preço? Sim/Não" confirmation.
  2. **Photo-to-prices** — upload a menu photo, extract `{type, brand, price}` via Vercel AI Gateway, and show a prefilled form the user confirms.
