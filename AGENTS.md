# BrejaMap: notes for coding agents

Read this first when starting work in a new session.

## Project

- Crowdsourced map of beer prices in bars (Brazil, starting in São Carlos/SP). Production: https://brejamap.vercel.app (Vercel).
- Stack: Next.js 15.5 (App Router) + React 19 + TypeScript + Tailwind CSS + Google Maps (`@react-google-maps/api`) + Supabase Postgres (project `marksrnjlviagfteprbd`).
- Migrations `001`–`004` are live in production, and writes are on (`USER_EDITS_ENABLED=true`).
- Known limit: GET /api/venues returns at most 500 venues per bbox (priced, then user-added, then nearest to the centre) with `truncated: true` and a "zoom in" hint when the area holds more; see docs/features.md §3.1.

## Where things live

- `docs/ROADMAP.md`: what's done, the current phase and the prioritized backlog. It's the only place for project status; update it when the backlog moves.
- `docs/features.md`: detailed spec of every implemented feature, API contracts, DB schema and files.
- `docs/setup.md`: environment variables, keys, migrations and login setup.
- `supabase/migrations/001..004_*.sql`: every migration applied in production.

## Conventions

- Never push directly to `master`; work on a feature branch and open a PR.
- Commit messages, branch names, code comments and PR titles/bodies are in **English**.
- User-facing UI strings and all documentation under `docs/` are in **Portuguese (pt-BR)**.
- When adding a feature or changing behavior, update `docs/features.md`; list any new doc in the `docs/README.md` table.
- Secrets go in Vercel environment variables and `.env.local`, never in git or a `NEXT_PUBLIC_*` variable.
- UI: concise, self-explanatory controls; don't add explanatory paragraphs that repeat what labels and buttons already say.
- Run `npm run lint`, `npm run test:scripts` and `npm run build` before pushing; all must pass with no errors or warnings.
