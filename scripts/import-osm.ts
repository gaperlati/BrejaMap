/**
 * Offline, operator-run import of bar/pub LOCATIONS from OpenStreetMap (Overpass) into public.venues.
 * No prices are imported or invented; users add them later in the app.
 *
 * Dry-run by default (no database access). Writing needs --write plus SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment, and migration 002_venues_external_id.sql applied.
 *
 *   npm run import:osm -- --preset sao-carlos
 *   npm run import:osm -- --preset sao-paulo   (2 bboxes + municipal boundary filter)
 *   npm run import:osm -- --bbox -22.08,-47.96,-21.96,-47.82 --city "São Carlos"
 *   npx tsx --env-file=.env.local scripts/import-osm.ts --preset sao-carlos --write
 *
 * Data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
 */

import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { fetchOsmBars, fetchOsmRelation, OVERPASS_URL, type OsmBar } from "../src/lib/overpass";
import {
  PRESETS,
  DEFAULT_PRESET,
  boundaryFromRelation,
  buildImportRows,
  foldPlaceName,
  type Boundary,
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
                Presets com limite municipal só importam bares dentro do município.
  --bbox        Área explícita em graus decimais, dentro de SP, no máximo 0,5° por lado.
  --city        Cidade usada quando o OSM não informa addr:city (só com --bbox). Sem ela, fica vazio.
  --write       Grava no Supabase (sem isso é dry-run e não acessa o banco).
  --out         Salva as linhas mapeadas em JSON para revisão.
  --max-retries Novas tentativas após 429/502/503/504 do Overpass (padrão 1, máximo 3).

Dados © colaboradores do OpenStreetMap, licença ODbL.`;

/** Pause between sequential Overpass requests of one run, to stay polite to the public server. */
const REQUEST_GAP_MS = 5_000;

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

  const requests = opts.bboxes.length + (opts.boundaryRelationId === null ? 0 : 1);
  console.log(`Escopo: ${opts.scope}`);
  for (const { south, west, north, east } of opts.bboxes) {
    console.log(`  bbox ${south},${west},${north},${east}`);
  }
  if (opts.boundaryRelationId === null) {
    console.log(`Cidade quando o OSM não informa: ${opts.fallbackCity || "(vazio)"}`);
  } else {
    console.log(`Limite municipal: relação OSM ${opts.boundaryRelationId}; cidade gravada: ${opts.fallbackCity}`);
  }
  console.log(`Consultando ${OVERPASS_URL} (${requests} ${requests === 1 ? "requisição" : "requisições em sequência"})...`);

  const fetchOptions = {
    maxRetries: opts.maxRetries,
    onRetry: ({ attempt, status, waitMs }: { attempt: number; status: number; waitMs: number }) =>
      console.warn(`Overpass respondeu ${status}; tentativa ${attempt} em ${Math.round(waitMs / 1000)} s...`),
  };
  let sent = 0;
  const politePause = async () => {
    if (sent++ > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  };

  // Boundary first: if it cannot be loaded the run aborts before importing anything unfiltered.
  let boundary: Boundary | null = null;
  if (opts.boundaryRelationId !== null) {
    await politePause();
    boundary = boundaryFromRelation(await fetchOsmRelation(opts.boundaryRelationId, fetchOptions));
    if (foldPlaceName(boundary.name) !== foldPlaceName(opts.fallbackCity)) {
      throw new Error(
        `relação OSM ${opts.boundaryRelationId} é "${boundary.name}", esperado "${opts.fallbackCity}"`
      );
    }
    console.log(
      `Limite carregado: ${boundary.name} (${boundary.outer.length} anel(is) externo(s), ${boundary.inner.length} interno(s))`
    );
  }

  const bars: OsmBar[] = [];
  for (const [i, bbox] of opts.bboxes.entries()) {
    await politePause();
    const part = await fetchOsmBars(bbox, fetchOptions);
    if (opts.bboxes.length > 1) console.log(`  bbox ${i + 1}/${opts.bboxes.length}: ${part.length} elementos`);
    bars.push(...part);
  }
  const summary = buildImportRows(bars, { ...opts, boundary });

  console.log(`OSM: ${bars.length} elementos (bar/pub)`);
  console.log(`  prontos para importar: ${summary.rows.length}`);
  console.log(`  ignorados sem nome: ${summary.skippedUnnamed}`);
  console.log(`  ignorados fora da área/SP: ${summary.skippedOutOfScope}`);
  if (boundary) console.log(`  ignorados fora do município: ${summary.skippedOutsideBoundary}`);
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
