# Importar bares do OpenStreetMap (operador)

Script offline, rodado manualmente, que importa **apenas a localização** de bares e pubs (`amenity=bar|pub`) do OpenStreetMap via Overpass para a tabela `venues`. **Não importa nem inventa preços**: os bares aparecem sem preço e a comunidade adiciona depois. O app nunca chama o Overpass durante o uso.

**Pré-requisito para gravar**: rodar `supabase/migrations/002_venues_external_id.sql` no SQL Editor do Supabase (adiciona a coluna `external_id`, opcional e única). Linhas existentes continuam válidas.

```bash
# Dry-run (padrão): consulta o Overpass e mostra o que seria importado; não acessa o banco
npm run import:osm -- --preset sao-carlos
npm run import:osm -- --preset sao-carlos --out osm-sao-carlos.json   # salva as linhas para revisar
npm run import:osm -- --preset sao-paulo    # capital: 2 bboxes + filtro pelo limite do município

# Área explícita (sul,oeste,norte,leste), dentro de SP e com no máximo 0,5° por lado
npm run import:osm -- --bbox -22.08,-47.96,-21.96,-47.82 --city "São Carlos"

# Gravar (exige --write, escopo explícito e SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no ambiente)
npx tsx --env-file=.env.local scripts/import-osm.ts --preset sao-carlos --write

# Testes do script (sem rede e sem banco)
npm run test:scripts
```

- **Sem argumentos** o script usa o preset `sao-carlos` (área urbana de São Carlos, cidade de lançamento) em dry-run.
- **Modo explícito**: `--dry-run` também é aceito; combiná-lo com `--write` é um erro, antes de qualquer acesso à rede.
- **Bares cadastrados manualmente**: sem o mesmo `external_id`, um cadastro existente não impede uma nova linha do OSM. Revise possíveis duplicatas; o script não concilia esses registros.
- **Limite municipal**: os presets `sao-carlos` (relação OSM 297986) e `sao-paulo` (298285) só importam bares dentro do município; o script baixa o limite uma vez por execução e aborta se não conseguir (nunca importa sem o filtro). `--bbox` não tem esse filtro.
- **Cidade**: nos presets, todo bar dentro do limite municipal recebe o nome canônico da cidade (ex.: "São Paulo", mesmo que o OSM diga "Sao Paulo"). Com `--bbox`, vem de `addr:city` do OSM; se faltar, usa `--city`; sem `--city`, fica vazia (nunca vira "São Paulo").
- **Ignorados**: lugares sem nome, fora das bboxes/SP, marcados com outro estado ou fora do município do preset.
- **Idempotente e conservador**: cada bar recebe `external_id` tipado (`osm-node-123`, `osm-way-123`, `osm-relation-123`) com `source='osm'` e `user_added=false`. A gravação é `INSERT ... ON CONFLICT (external_id) DO NOTHING`: rodar de novo (ou em paralelo) não duplica, e bares já existentes **não são alterados** — nome, preços, happy hour e edições da comunidade ficam como estão. A tabela `beer_prices` nunca é tocada. Para trazer mudanças do OSM em bares já importados, é preciso tratar à parte.
- **Overpass**: requisições sequenciais (limite municipal + uma por bbox, com pausa de 5 s entre elas), cada uma com timeout; em 429/502/503/504 tenta de novo no máximo `--max-retries` vezes (padrão 1), respeitando `Retry-After`, e para com erro claro se a espera for longa. Não rode em loop.
- **Atribuição**: dados © colaboradores do OpenStreetMap, licença [ODbL](https://www.openstreetmap.org/copyright). O app já mostra “Dados do OpenStreetMap” no detalhe do bar.

Detalhes técnicos (mapeamento de campos, limite municipal, arquivos) em [features.md §3.3](./features.md#33-importação-de-bares-do-openstreetmap-script-do-operador).
