/**
 * Offline, operator-run import of bar/pub LOCATIONS from OpenStreetMap (Overpass) into public.venues.
 * No prices are imported or invented; users add them later in the app.
 *
 * Dry-run by default (no database access). Writing needs --write plus SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment, and migration 002_venues_external_id.sql applied.
 *
 *   npm run import:osm -- --preset sao-carlos
 *   npm run import:osm -- --bbox -22.08,-47.96,-21.96,-47.82 --city "São Carlos"
 *   npx tsx --env-file=.env.local scripts/import-osm.ts --preset sao-carlos --write
 *
 * Data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
 */

import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { fetchOsmBars, OVERPASS_URL } from "../src/lib/overpass";
import {
  PRESETS,
  DEFAULT_PRESET,
  buildImportRows,
  checkExternalIdColumn,
  createSupabaseWriter,
  parseArgs,
  readSupabaseEnv,
  writeRows,
} from "./lib/osm-import";

const USAGE = `Importa localizações de bares/pubs do OpenStreetMap (sem preços) para a tabela venues.

Uso:
  npm run import:osm -- [--preset <nome> | --bbox sul,oeste,norte,leste [--city <nome>]]
                        [--write] [--out arquivo.json] [--max-retries 0-3]

  --preset      Área pronta (padrão: ${DEFAULT_PRESET}). Disponíveis: ${Object.keys(PRESETS).join(", ")}
  --bbox        Área explícita em graus decimais, dentro de SP, no máximo 0,5° por lado.
  --city        Cidade usada quando o OSM não informa addr:city (só com --bbox). Sem ela, fica vazio.
  --write       Grava no Supabase (sem isso é dry-run e não acessa o banco).
  --out         Salva as linhas mapeadas em JSON para revisão.
  --max-retries Novas tentativas após 429/502/503/504 do Overpass (padrão 1, máximo 3).

Dados © colaboradores do OpenStreetMap, licença ODbL.`;

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.ok === "help") {
    console.log(USAGE);
    return 0;
  }
  if (!parsed.ok) {
    console.error(`Erro: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  const opts = parsed.options;
  const { south, west, north, east } = opts.bbox;

  // Validate write configuration before any network request.
  let writer: ReturnType<typeof createSupabaseWriter> | null = null;
  if (opts.write) {
    const env = readSupabaseEnv(process.env);
    if (!env.ok) {
      console.error(`Erro: ${env.error}`);
      return 2;
    }
    const client = createClient(env.url, env.key, { auth: { persistSession: false } });
    console.log(`Modo: ESCRITA no Supabase (${env.host})`);
    await checkExternalIdColumn(client);
    writer = createSupabaseWriter(client);
  } else {
    console.log("Modo: dry-run (nada é gravado; use --write para gravar)");
  }

  console.log(`Escopo: ${opts.scope} – bbox ${south},${west},${north},${east}`);
  console.log(`Cidade quando o OSM não informa: ${opts.fallbackCity || "(vazio)"}`);
  console.log(`Consultando ${OVERPASS_URL} (uma requisição)...`);

  const bars = await fetchOsmBars(opts.bbox, {
    maxRetries: opts.maxRetries,
    onRetry: ({ attempt, status, waitMs }) =>
      console.warn(`Overpass respondeu ${status}; tentativa ${attempt} em ${Math.round(waitMs / 1000)} s...`),
  });
  const summary = buildImportRows(bars, opts);

  console.log(`OSM: ${bars.length} elementos (bar/pub)`);
  console.log(`  prontos para importar: ${summary.rows.length}`);
  console.log(`  ignorados sem nome: ${summary.skippedUnnamed}`);
  console.log(`  ignorados fora da área/SP: ${summary.skippedOutOfScope}`);
  console.log(`  ignorados repetidos: ${summary.skippedDuplicate}`);

  if (opts.outFile) {
    await writeFile(opts.outFile, JSON.stringify(summary.rows, null, 2) + "\n", "utf8");
    console.log(`Linhas salvas em ${opts.outFile}`);
  }

  if (!writer) {
    for (const row of summary.rows.slice(0, 10)) {
      console.log(`  ${row.external_id}  ${row.name} – ${[row.address, row.neighborhood, row.city].filter(Boolean).join(", ")}`);
    }
    if (summary.rows.length > 10) console.log(`  ... e mais ${summary.rows.length - 10}`);
    return 0;
  }

  const result = await writeRows(writer, summary.rows);
  console.log(`Gravado: ${result.inserted} novos; ${result.alreadyPresent} já existiam (mantidos sem alteração).`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    console.error(`Erro: ${err instanceof Error ? err.message : String(err)}${cause}`);
    process.exitCode = 1;
  }
);
