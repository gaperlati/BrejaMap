# BrejaMap

Mapa de preços de cerveja para o estado de São Paulo, com foco no interior (o mapa abre em São Carlos quando não há localização do usuário). Encontre bares com os melhores preços, filtre por tipo, bairro e happy hour.

## Configuração

1. **Variáveis de ambiente**
   - Copie `.env.example` para `.env.local` (lá estão todas as variáveis, com comentários). No Vercel, defina as mesmas em Project Settings → Environment Variables ou use `vercel env pull .env.local`.
   - **Mapa**: em [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie uma chave e ative **Maps JavaScript API**. Defina `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
   - **Backend (bares no mapa)**: crie um projeto em [Supabase](https://supabase.com), em Settings → API copie URL e **service_role** key. Defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Rode, em ordem, os SQLs de `supabase/migrations/` no SQL Editor do Supabase: `001_venues_and_beer_prices.sql` (tabelas), `002_venues_external_id.sql` (coluna `external_id`, usada pela importação do OSM) `003_atomic_venue_writes.sql` (funções `update_venue_and_prices` e `create_venue_with_prices`, que gravam bar + preços numa única transação) e `004_auth_rate_limits_and_moderation.sql` (autoria, rate limit, sinalização de preços e RLS em todas as tabelas; sem 003 e 004, adicionar bar, editar preços e sinalizar retornam 500). Todos podem ser rodados mais de uma vez, sempre nessa ordem.

**Para publicar com dados iniciais**: depois da migração, rode também `supabase/seed.sql` no SQL Editor. Isso insere os bares de exemplo (São Paulo, Campinas e um template em Av. Faria Lima, 949). Sem o seed, o mapa começa com os bares mock em memória até a primeira busca; com o seed, "Buscar bares" já devolve dados reais do banco.

   - **Login (para cadastrar bares)**: defina `NEXT_PUBLIC_SUPABASE_URL` (mesma URL do projeto) e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (chave **anon** pública, em Settings → API). Elas vão para o navegador e são seguras: a migração 004 liga RLS em todas as tabelas sem políticas para `anon`/`authenticated`, então essa chave não lê nem grava nada direto no banco; todos os dados passam pelas rotas `/api` (que usam a `service_role` no servidor). No painel do Supabase:
     - Authentication → URL Configuration: coloque a URL do site (e `http://localhost:3000` para dev) em **Site URL** / **Redirect URLs**.
     - Authentication → Providers → **Google**: ative e informe o Client ID/Secret criados no Google Cloud (OAuth, redirect `https://<projeto>.supabase.co/auth/v1/callback`).
     - Authentication → Email Templates → **Magic Link**: inclua `{{ .Token }}` no texto para o e-mail trazer o código de 6 dígitos além do link (o modal aceita os dois).
     - Sem essas variáveis, o card de login não aparece e criar bar responde 401 sempre que o backend estiver configurado. Editar preços e sinalizar preços não exigem login.
   - **Escrita em produção**: adicionar bar, editar preços e sinalizar preços ficam **bloqueados em produção** (403) até `USER_EDITS_ENABLED=true` — é o interruptor geral: voltar para `false` desliga todas as escritas na hora. Antes de ligar, aplique as migrações 003 e 004. Em `npm run dev` a escrita sempre funciona (mas criar bar continua exigindo login quando o backend está configurado).
   - **Anti-abuso**: escritas têm rate limit no Postgres (tabela `write_rate_limits`), por IP com hash SHA-256 + sal (`RATE_LIMIT_SALT`, opcional; padrão: a service role key) — o IP nunca é gravado. Limites: editar preços 10/10 min por IP e 3/10 min por (IP, bar); criar bar 5/hora por usuário e por IP; sinalizar 5/10 min por IP. Excedeu → 429 com `Retry-After`. Bares sinalizados ficam com `needs_review = true` (fila: `select * from venues where needs_review`).

2. Instale e rode:

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Se o backend não estiver configurado, o mapa mostra apenas os bares mock; ao configurar Supabase, “Buscar bares” e o carregamento automático ao pan/zoom passam a usar o banco.

## Importar bares do OpenStreetMap (operador)

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
- **Overpass**: uma única requisição por execução, com timeout; em 429/502/503/504 tenta de novo no máximo `--max-retries` vezes (padrão 1), respeitando `Retry-After`, e para com erro claro se a espera for longa. Não rode em loop.
- **Atribuição**: dados © colaboradores do OpenStreetMap, licença [ODbL](https://www.openstreetmap.org/copyright). O app já mostra “Dados do OpenStreetMap” no detalhe do bar.

## Funcionalidades

- **Mapa (Google Maps)** com marcadores em formato de preço (balão “R$ X,X”)
- **Bares no mapa**: carregamento automático ao pan/zoom (debounce 2 s) ou botão “Buscar bares”; dados vêm do **nosso backend** (Supabase), não do Google Places no cliente
- **Pesquisar endereço** para centralizar o mapa
- **Filtros**: preço máximo, tipo de cerveja, bairro, happy hour
- **Toggle Mapa / Lista**, **bottom sheet** ao clicar em um bar, **Adicionar bar** e **Adicionar/editar preços** (persistem no backend quando configurado)

**Documentação**: pasta [docs/](docs/). Ver **MGB_FEATURES_AND_BRAZIL.md** para comparação com MisterGoodBeer.
