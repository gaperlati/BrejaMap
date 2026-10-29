# BrejaMap – Funcionalidades

Documentação das funcionalidades atuais do app. Atualizada conforme novas tarefas e features são implementadas.

---

## Visão geral

**BrejaMap** é um mapa de preços de cerveja para o estado de São Paulo. O usuário encontra bares com os melhores preços, filtra por tipo de bebida, bairro e happy hour, e alterna entre vista de mapa e lista.

- **Stack**: Next.js 15 (15.5.x), React 19 (19.2.x), TypeScript, Tailwind CSS, Google Maps JavaScript API. **Backend**: Supabase (Postgres) para venues e preços.
- **Dados**: o mapa e a lista de bares vêm do **nosso backend** (GET /api/venues por bounds). Não há mais chamadas ao Google Places no cliente; a latência e o payload são controlados pelo nosso banco. Sem backend configurado, o mapa começa vazio (não há mais bares de exemplo em memória).
- **Identidade no navegador**: favicon com caneca de cerveja escura e espuma clara sobre fundo âmbar. O Next.js registra automaticamente `src/app/icon.svg`, `src/app/favicon.ico` (16, 32 e 48 px) e `src/app/apple-icon.png` (180 px) para abas, favoritos e atalhos no iOS.

---

## 1. Mapa (Google Maps)

- **Inicialização do mapa**: o mapa abre em São Carlos (`SAO_CARLOS_CENTER`, zoom 13) e consulta a geolocalização do navegador ao iniciar (timeout de 4 s). Se a permissão for concedida antes de o usuário mover o mapa (arrastar, dar zoom, pesquisar endereço ou tocar em “Onde estou”), o mapa centraliza na localização do usuário com zoom 14, sem marcador azul; se o usuário já tiver interagido, a localização é usada só para a ordenação “Mais perto”. Se for negada ou expirar, o mapa permanece em São Carlos — não há fallback por geolocalização de IP (que levava o mapa para São Paulo capital).
- **API**: Google Maps JavaScript API. Chave em `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (`.env.local`).
- **Marcadores em formato de preço**: balão “R$ X,X” com o menor preço do bar (vermelho; amarelo quando selecionado).
- **Agrupamento de marcadores por preço** (`clusterMapVenues` em `src/lib/map-markers.ts`): os bares são projetados em pixels (Web Mercator, `256 · 2^zoom`) e, abaixo do zoom **18**, marcadores que se sobreporiam na tela são agrupados de forma gulosa, em ordem de prioridade:
  - O **bar selecionado** é colocado primeiro, sempre como balão amarelo individual e por cima de todos (`zIndex` 1000); nunca entra num grupo.
  - Depois os **bares com preço**, do **mais barato** para o mais caro (empate: cadastrados por usuário primeiro, depois id). Quando dois balões colidem, o mais barato fica com o marcador e o grupo é ancorado nele; balões mais baratos também ficam por cima (`zIndex` maior).
  - Por último os **bares sem preço** (ex.: importados do OSM), que cedem espaço aos com preço e entram no grupo do bar com preço vizinho.
- **Grupo com preço**: balão um pouco mais largo com o melhor preço do local e um selo escuro “+N” com a quantidade de outros bares ali.
- **Grupo só de bares sem preço**: círculo escuro com borda âmbar e o número de bares, posicionado no centro do grupo (em vez de vários balões “?” empilhados).
- **Bares sem preço isolados**: pino circular discreto (escuro, borda âmbar, “+”) a partir do zoom **16**; abaixo disso, um ponto pequeno. Continuam clicáveis para adicionar preços.
- **Clique no grupo**: centraliza o mapa no grupo e aproxima **2 níveis** de zoom (máximo 18) para separar os bares. No zoom **≥ 18** nada é agrupado, então bares vizinhos no mesmo quarteirão sempre podem ser tocados individualmente.
- O agrupamento usa o zoom ao vivo do mapa (`zoom_changed`), então os grupos se desfazem/refazem durante o zoom. Testes: `src/lib/map-markers.test.ts` (em `npm run test:scripts`).
- Atualização de centro/zoom quando o usuário pesquisa endereço ou interage com o mapa.
- Exibição de um marcador adicional (azul) para o resultado da busca de endereço.
- **Onde estou**: botão flutuante (📍) no mapa recentraliza com `navigator.geolocation` (zoom 14); em caso de negação/erro não mostra alerta (o usuário pode usar a busca de endereço).
- Área do mapa com altura mínima maior em telas pequenas (`min(52vh, 520px)`) para gestos de pan mais confortáveis no celular.
- **Mobile (um dedo no mapa)**: `gestureHandling: "greedy"` no Google Map (evita o modo *cooperative*, que exige dois dedos quando a página é rolável) e o container do mapa usa `touch-none` para o navegador não roubar o pan com `touch-action` de scroll.
- **Controles nativos:** `disableDefaultUI: true` e reabilitação só do zoom + tela cheia no desktop; **`cameraControl`**, rotação e pan legados ficam desligados (remove a pilha circular de pan/zoom do mapa vetorial que ainda aparecia no mobile).
- Zoom no canto inferior **direito** só no desktop; em **viewports ≤639px** zoom e tela cheia nativos ficam ocultos (pinça continua no celular).
- Botão **“Onde estou”** fica no canto **inferior esquerdo**, acima do crédito Google e da área segura, para não conflitar com os controles à direita no desktop.
- **Bounds reporting**: quando o zoom fica **< 12**, o mapa avisa o parent para **remover** os bares carregados da API da lista (permanecem só os adicionados pelo usuário na sessão).
- **Carregamento automático ao pan/zoom**: durante o movimento a app atualiza apenas o “alvo” do carregamento (sem sincronizar center/zoom/re-render pesado); no evento `idle` ela faz um relatório final e o zoom **≥ 12** dispara a busca ao **nosso backend** (GET /api/venues?bounds=...) após **~150 ms** de debounce (sem cooldown fixo). Não há chamadas ao Google Places no cliente.
- **Overscanning**: os bounds visíveis são expandidos em **25%** antes de enviar ao backend; a resposta traz bares um pouco fora da tela para micro-pans sem nova requisição.
- **Merge por ID**: resultados novos são **mesclados** aos já carregados (por ID). Até 300 venues em memória (evição ao ultrapassar).
- **Deduplicação no estado do cliente**: após cada merge de resultados, o frontend também elimina duplicatas por nome+coordenada (com priorização de user-added, com preços e mais recente) para evitar itens repetidos na lista quando múltiplas buscas da mesma área retornam venues equivalentes.
- **Buscar bares no clique**: botão **“Buscar bares”** carrega imediatamente a área visível. Se o zoom for **< 12**, mostra “Dê mais zoom no mapa para buscar bares desta área”.
  - A área visível vem do **mapa ao vivo**: `Map` entrega um handle pelo callback `onReady` (em vez de `ref`, que não é repassado de forma confiável pelo `next/dynamic`) e `page.tsx` guarda em `mapHandleRef`; `getCurrentBounds()` lê bounds/zoom do Google Maps no momento do clique. Quando o mapa desmonta (vista Lista, `onUnmount`, StrictMode), a função de limpeza devolvida limpa o handle — só se ainda for o mesmo, para não apagar o de um mapa remontado. Sem handle (mapa ainda carregando), usa o centro/zoom do estado como fallback. Ao carregar uma nova instância, a deduplicação dos relatórios de bounds é reiniciada. Teste: `node --test src/lib/mapHandle.test.mjs` (Node 22.18+ ou 24; testa o handle com mapa simulado, sem interação real com Google Maps).
- **Cache**: até 30 regiões (chave = bounds arredondados); mesma área reutiliza o cache (sem cooldown fixo).

- **Barra inferior (Mapa / Adicionar bar)**: `viewportFit: "cover"` no layout para `env(safe-area-inset-bottom)` funcionar no iOS; classe `.safe-area-pb` em `globals.css` com `padding-bottom: max(0.75rem, env(...))`; shell da página usa `h-dvh` em vez de `100vh` para acompanhar a barra dinâmica do Safari.

**Arquivos**: `src/components/Map.tsx`, `src/lib/map-markers.ts` (agrupamento de marcadores), `src/app/page.tsx`, `src/lib/use-venues-map.ts` (estado do mapa, geolocalização e carregamento de bares), `src/lib/venue-state.ts` (merge e cache por bbox), `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/geo.ts` (overscan de bounds), `src/lib/mapHandle.ts` (handle do mapa para “Buscar bares”).

---

## 2. Pesquisar endereço

- Campo de busca no header: “Pesquisar endereço”.
- Busca com **Nominatim (OpenStreetMap)** em todo o Brasil (`countrycodes=br`, resultados em pt-BR, `limit=12`, `dedupe=1`); resultados em dropdown (debounce 400 ms), no máximo 6. Cada nova digitação cancela a busca anterior.
- **Limite de 1 requisição/s do Nominatim** (`createRequestScheduler`, `src/lib/request-scheduler.ts`): todas as chamadas ao Nominatim da aba (busca do mapa principal, busca do “Adicionar bar” e geocodificação reversa) passam por uma única fila que garante pelo menos 1 s entre o início de duas requisições. Uma busca cancelada enquanto espera na fila sai na hora e nunca é enviada. Erros HTTP (ex.: 429) viram “a busca falhou”, não “nenhum resultado”. A fila é por aba do navegador, não global.
- **Preferência por SP sem excluir o resto do país**: `viewbox` cobrindo o estado de São Paulo com `bounded=0`, então cidades de outros estados continuam aparecendo, só que abaixo.
- **Ranking no cliente** (`rankNominatimResults`): título exato ou prefixo da busca (sem diferenciar acentos, “sao carlos” = “São Carlos”) > resultados no **estado de SP** > proximidade da localização do usuário (ou do centro do mapa, via `biasLocation`) > tipo do lugar (cidade, bairro, rua e bar acima de povoados e limites administrativos) e `importance` do Nominatim. Ex.: “São Carlos” mostra São Carlos (SP) em 1º, e São Carlos (SC) e São Carlos (Rosário do Sul, RS) logo abaixo.
- **Deduplicação** (`dedupeNominatimResults`): o nó da cidade e a relação do limite administrativo da mesma cidade viram um único resultado (mesmo título + cidade + UF + tipo). Ruas/bares homônimos só são unidos se estiverem a até ~1 km.
- **Rótulos limpos** (`formatNominatimResult`): título em destaque + subtítulo, sem “Região Sudeste”, “Região Geográfica…”, CEP ou “Brasil”, e sem repetir o título no subtítulo:
  - Cidade: “São Carlos” / “São Paulo, SP”; povoado mostra o município (“Rosário do Sul, RS”).
  - Bairro: “Centro” / “São Carlos, SP”.
  - Rua: “Av. São Carlos, 2100” / “Centro · São Carlos - SP”; local (bar etc.): nome do local / rua + bairro + cidade.
- **Zoom conforme o tipo**: ao selecionar, o mapa centraliza com zoom **13** (cidade), **14** (bairro) ou **16** (rua/local); marcador de busca é exibido e o campo mostra um rótulo curto (ex.: “São Carlos, SP”).
- **Adicionar bar** (`searchAddressNear`): a busca do modal procura **primeiro só perto do pino** (`viewbox` de ~15 km em volta, `bounded=1`), para que um nome de rua comum (ex.: “Rua Alvarenga Peixoto”) não traga Campinas, Sorocaba etc. antes da rua de São Carlos; só se nada for encontrado ali faz a busca normal no estado (a segunda requisição só acontece depois da primeira vazia e passa pela fila de 1 req/s acima) e avisa “Nada com esse nome perto do mapa. Resultados de outras cidades”. Cada resultado mostra a distância até o pino (“a 350 m”, “a 2,3 km”). Ver seção 7.
- Placeholder configurável.
- Testes: `src/lib/geocode.test.ts` e `src/lib/request-scheduler.test.ts` (em `npm run test:scripts`; relógio virtual, sem esperas reais).

**Arquivos**: `src/components/AddressSearch.tsx`, `src/components/AddVenueModal.tsx`, `src/lib/geocode.ts`, `src/lib/request-scheduler.ts`, `src/lib/geo.ts`.

---

## 3. Filtros

- **Chips** (header): Happy hour, Filtros (com indicador quando há filtros ativos), Buscar bares — sem rótulo textual extra ao lado do happy hour.
- **Painel de filtros**: aberto pelo chip “Filtros” no header ou pela sidebar (desktop). O chip “Filtros” fica destacado quando há filtros ativos (indicador visual).
- **Chip “Buscar bares”**: carrega bares da **nossa API** (backend Supabase) na área visível (zoom ≥ 12). Carregamento automático ao pan/zoom (debounce ~150 ms). Se o backend não estiver configurado, mostra mensagem e o mapa fica vazio.
- **Preço máximo (R$)**: filtra bares cujo menor preço seja ≤ valor (bares sem preços ficam de fora).
- **Tipo de cerveja**: filtra bares que tenham ao menos um preço daquele tipo (bares sem preços ficam de fora).
- **Bairro**: lista os bairros dos bares visíveis (ignora vazios, ordem pt-BR).
- **Apenas happy hour**.
- **Ordenar**: Menor preço, Maior preço, **Mais perto** e Nome. "Mais perto" usa a última localização conhecida do usuário (geolocalização do navegador); sem ela, a distância é medida a partir do centro do mapa (`distanceKm` em `src/lib/geo.ts`).

**Arquivos**: `src/components/FilterBar.tsx`, `src/components/FilterChips.tsx`, `src/app/page.tsx`, `src/lib/use-venue-filters.ts`, `src/lib/venue-state.ts` (filtros e ordenação), `src/lib/api.ts`, `src/lib/geo.ts`.

---

## 3.1. Backend (Supabase) e fontes de dados

- **Fonte de pins no mapa**: o cliente **não** chama mais o Google Places. Ao pan/zoom (idle, zoom ≥ 12) ou ao clicar em “Buscar bares”, o frontend chama **GET /api/venues?bounds=south,west,north,east**. O Next.js consulta o Supabase (tabelas `venues` e `beer_prices`) e devolve um JSON enxuto com os venues na bounding box. Isso elimina a latência e o payload pesado do Places no cliente.
- **Deduplicação de venues no GET**: quando existem linhas repetidas no banco para o mesmo local (mesmo nome + coordenadas muito próximas), a API responde apenas uma entrada para evitar cards/pins duplicados. A priorização mantém, nessa ordem, venues adicionados por usuário, depois venues com preços e por fim o registro mais recente.
- **Persistência**: **POST /api/venues** (adicionar bar), **PATCH /api/venues/[id]** (adicionar/editar preços e happy hour) e **POST /api/venues/[id]/report** (sinalizar preços) gravam no Supabase. Se o backend não estiver configurado (503), o app usa apenas estado local (edições em memória). Qualquer **outra falha** (401 sem login, 403 com escrita desativada, 429 por rate limit, 400, 500, rede) é mostrada no próprio modal e o modal continua aberto; o app não finge mais que salvou. Mensagens em pt-BR em `saveErrorMessage` (`src/lib/api.ts`): 401 → “Faça login para adicionar um novo bar.”; 429 → “Muitas alterações em pouco tempo. Aguarde alguns minutos e tente novamente.”
- **Validação no servidor** (`src/lib/venue-server.ts`, compartilhado pelas duas rotas):
  - GET: bounds precisam ser números finitos, ordenados, com no máximo **2°** por lado; resposta limitada a **500** venues.
- **GET /api/venues — contrato e áreas densas** (`src/app/api/venues/route.ts`, `src/lib/venue-selection.ts`):
  - Resposta: `{ venues: Venue[], truncated: boolean }`. `truncated` é `true` quando a bbox tem mais bares do que os devolvidos.
  - Os preços vêm embutidos na consulta dos venues (`select("*, beer_prices(*)")`, pela FK `beer_prices.venue_id`); não há mais a segunda consulta com `.in("venue_id", ids)`, cuja URL chegava a ~18 KB com 500 ids. Não precisa de migração.
  - São três consultas limitadas em paralelo (bares com preço via `beer_prices!inner`, bares `user_added` e o restante), cada uma com no máximo **1000** linhas (o `max-rows` padrão do Supabase) e `count: "exact"`. Nenhuma consulta devolve um número ilimitado de linhas; se alguma contagem passar do que veio, a resposta é `truncated`.
  - Depois da deduplicação, quando passa de 500 a API mantém primeiro os bares **com preço**, depois os **adicionados por usuários** e por fim os demais (ex.: importados do OSM), cada grupo ordenado pela **distância ao centro da bbox**. Se um grupo tiver mais de 1000 bares na bbox, só os 1000 mais recentes entram no ranking por distância (aproximação aceitável no zoom ≥ 12).
  - No cliente, enquanto a vista atual estiver `truncated`, aparece abaixo dos filtros o aviso “Dê mais zoom para ver todos os bares desta área”, que some ao aproximar o mapa. O cache por bbox (`VenueBboxCache` em `src/lib/venue-state.ts`) reutiliza uma resposta completa para qualquer vista dentro da área buscada, mas uma resposta truncada só serve para a mesma vista: ao dar zoom, o app busca de novo. O estado guarda até 1000 bares externos (`MAX_EXTERNAL_VENUES`), descartando primeiro os carregados antes, para não cortar uma resposta de 500.
  - POST: nome de 2–80 caracteres; lat/lng dentro do **estado de SP** (bbox aproximada); textos de endereço truncados em 200 caracteres.
  - Preços (POST e PATCH): até 20 itens; tipo válido; marca 1–60 caracteres; preço > 0 e ≤ **R$ 500** (arredondado a centavos); volume opcional ≤ 5000 ml.
  - PATCH: id precisa ser UUID; tudo é validado antes de acessar o banco; responde 404 se o bar não existe (sem alterar nada); erros do banco retornam 500 (`Failed to update venue` / `Failed to update beer prices`).
  - Mensagens de erro do banco não são devolvidas ao cliente (só logadas no servidor). No GET, qualquer falha do banco (inclusive Supabase fora do ar) responde 500 com `{ error: "Failed to load venues", venues: [] }`, e o mapa mostra uma mensagem amigável em pt-BR (`loadVenuesErrorMessage` em `src/lib/api.ts`).
- **Escritas atômicas** (`supabase/migrations/003_atomic_venue_writes.sql`, `src/lib/venue-writes.ts`): o PATCH chama a função Postgres `update_venue_and_prices` e o POST chama `create_venue_with_prices` via `supabase.rpc`, em **uma única ida ao banco**. Cada função roda numa transação: atualizar happy hour, apagar os preços antigos e inserir os novos (ou criar o bar e seus preços) acontece por inteiro ou não acontece; um bar nunca fica com preços apagados ou sem preço por falha no meio. As funções só podem ser executadas pela `service_role`. Sem a migração 003 aplicada, as escritas retornam 500 (o log do servidor indica a migração faltante).
- **Writes (produção) — interruptor geral**: em produção, toda escrita (criar bar, editar preços, sinalizar) responde 403 a menos que `USER_EDITS_ENABLED=true` (`writesBlockedResponse` em `src/lib/venue-server.ts`). Voltar a variável para `false` desliga todas as escritas na hora.
- **Auth e anti-abuso** (`supabase/migrations/004_auth_rate_limits_and_moderation.sql`, `src/lib/write-guards.ts`):
  - **Criar bar exige login**: o POST exige `Authorization: Bearer <access_token>` válido (verificado com `supabase.auth.getUser`); sem token ou com token inválido/expirado responde **401** `{ error: "Authentication required" }`. O id do usuário vai em `venues.created_by` (`p_created_by` de `create_venue_with_prices`).
  - **Editar preços não exige login**: o PATCH aceita anônimos. Se vier um token válido, o id do usuário é gravado em `venues.last_edited_by`; token inválido só torna a edição anônima. Toda edição marca `prices_unverified = true` e `last_edited_at`.
  - **Rate limit no Postgres**: tabela `write_rate_limits` + função atômica `consume_write_rate_limits` (janela fixa; se algum limite estourou, nada é contado). A chave é SHA-256 do IP (primeiro `x-forwarded-for`, depois `x-real-ip`, senão `"unknown"`) com sal do servidor (`RATE_LIMIT_SALT` ou, na falta, `SUPABASE_SERVICE_ROLE_KEY`); o IP cru nunca é gravado. Limites: PATCH 10/10 min por IP e 3/10 min por (IP, bar); POST 5/hora por usuário e 5/hora por IP; report 5/10 min por IP. Estourou → **429** `{ error: "Too many requests" }` com `Retry-After` (segundos). Se o banco não responder, a escrita é recusada (500), nunca liberada sem limite.
  - **Sinalizar preços**: `POST /api/venues/[id]/report` (sem login, com rate limit) chama `flag_venue_for_review`, que marca `venues.needs_review = true`. Fila de moderação: `select * from venues where needs_review`.
  - **RLS**: `venues`, `beer_prices` e `write_rate_limits` têm RLS ligado e nenhuma política, e os privilégios de `anon`/`authenticated` foram revogados. A chave anon pública (usada só no login do navegador) não lê nem grava tabelas via PostgREST; a API usa a `service_role`, que ignora RLS. As funções só podem ser executadas pela `service_role`.
  - Sem a migração 004, POST/PATCH/report respondem 500 (o log indica a migração faltante).
- **Schema**: `venues` (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, photo_url, created_at, user_added, source, external_id, prices_unverified, needs_review, created_by, last_edited_by, last_edited_at); `beer_prices` (id, venue_id, type, label, price_brl, volume_ml, created_at); `write_rate_limits` (bucket, key_hash, window_started_at, reset_at, hits). A API devolve `pricesUnverified`, mas nunca `created_by`/`last_edited_by`/`needs_review`. Migrações em `supabase/migrations/001_venues_and_beer_prices.sql`, `002_venues_external_id.sql` (coluna `external_id` opcional e única, usada pela importação do OSM), `003_atomic_venue_writes.sql` (funções de escrita atômica do PATCH/POST) e `004_auth_rate_limits_and_moderation.sql` (autoria, `prices_unverified`, `needs_review`, rate limit, report e RLS).
- **Dados iniciais**: `venues` é populada offline pelo script de importação do OpenStreetMap (seção 3.3); o mapa continua consultando apenas o nosso banco.
- **Zoom out**: quando o zoom fica **< 12**, os venues carregados da API são removidos da lista (permanecem os user-added).

---

## 3.2. Deploy e dados iniciais (evitar mapa vazio)

Ao publicar o app, o Supabase começa vazio. Opções para o usuário não ficar frustrado:

1. **Bares de exemplo (removidos em 29/10/2026)**: o app iniciava com bares fictícios em memória (`MOCK_VENUES`) e o `supabase/seed.sql` gravava os mesmos bares no banco. Ambos foram removidos, junto com os 6 bares de seed (e seus 14 preços) da produção; o app agora parte de lista vazia e mostra só dados do banco.
2. **Empty state amigável**: quando não há nenhum bar na região (lista vazia sem filtros), a lista exibe "Nenhum bar nesta região ainda. Seja o primeiro a adicionar!" e botão **Adicionar bar**, convidando o usuário a contribuir.
3. **Importação do OpenStreetMap (estratégia escolhida)**: um operador roda o script `npm run import:osm` (seção 3.3) por cidade, começando por São Carlos. Ele grava apenas a localização dos bares, sem preços; a comunidade adiciona os preços depois. Não há fallback em tempo de requisição (o backend não chama Overpass nem Google Places) e não há scraping de Google Places/iFood.

---

## 3.3. Importação de bares do OpenStreetMap (script do operador)

- **O que faz**: consulta o Overpass para `amenity=bar|pub` (nós, ways e relações; ways/relações usam o centro) dentro de uma ou mais bboxes e grava em `venues` com `source='osm'`, `user_added=false`, sem preços. Na UI, esses bares aparecem com “Preços não informados” e o aviso “Dados do OpenStreetMap”.
- **Escopo**: `--preset sao-carlos` (padrão), `--preset sao-paulo` ou `--bbox sul,oeste,norte,leste`. Cada bbox é validada antes de qualquer requisição: números finitos, ordenados, dentro de SP e com no máximo 0,5° por lado. Um preset pode ter várias bboxes (São Paulo usa duas: núcleo `-23.80,-46.83,-23.36,-46.36` e sul `-24.01,-46.83,-23.80,-46.36`); elas são consultadas em sequência, com pausa de 5 s entre requisições, e bares repetidos entre bboxes são deduplicados por `external_id`.
- **Limite municipal**: um preset pode indicar a relação OSM do município (`sao-paulo` → 298285, `sao-carlos` → 297986). O script baixa a geometria uma vez por execução (`rel(<id>); out geom;`), monta os anéis externos/internos do multipolígono, confere que o nome da relação é a cidade do preset e mantém só bares cujo ponto está dentro do limite (regra par-ímpar, que respeita buracos). O resumo mostra “ignorados fora do município”. Se o limite não puder ser carregado (Overpass fora do ar, anel aberto, nome diferente), a execução é abortada — nunca importa sem o filtro. Com `--bbox` não há filtro municipal.
- **Mapeamento**: nome de `name`/`name:pt` (lugares sem nome são ignorados); endereço de `addr:street` + `addr:housenumber`; bairro de `addr:suburb`/`addr:neighbourhood`/`addr:quarter`. Cidade: em presets com limite municipal, todo bar dentro do limite recebe o nome canônico do preset (ex.: “São Paulo”), independentemente de `addr:city` (que tem grafias como “Sao Paulo” ou “são paulo”, e às vezes vem de cidades vizinhas); sem limite, vale `addr:city`/`addr:municipality` (variações de acento/maiúsculas da cidade do preset viram o nome canônico), com fallback para a cidade do preset ou `--city` (vazia em bbox genérica). Coordenadas fora das bboxes/SP ou estado diferente de SP são descartados.
- **Dry-run por padrão**: sem `--write` nada é gravado e o banco não é acessado. `--write` exige escopo explícito, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (validados antes da rede; a chave nunca é exibida) e a migração `002_venues_external_id.sql`.
- **Idempotência**: identidade estável `external_id` (`osm-node-123` ≠ `osm-way-123`) com índice único; a gravação é `INSERT ... ON CONFLICT (external_id) DO NOTHING`. Repetir ou rodar em paralelo não duplica, e bares já existentes nunca são alterados (preços, happy hour e edições ficam preservados). `beer_prices` nunca é tocada.
- **Limites do Overpass**: requisições sequenciais (limite municipal + uma por bbox), cada uma com timeout; 429/502/503/504 são repetidos no máximo `--max-retries` vezes (padrão 1), respeitando `Retry-After`. Qualquer falha aborta a execução antes de gravar.
- **Segurança do modo**: combinar `--dry-run` e `--write` é rejeitado antes da rede. A deduplicação usa `external_id`; bares cadastrados manualmente sem esse identificador podem gerar outra linha e precisam de revisão.
- **Atribuição**: dados © colaboradores do OpenStreetMap (ODbL).
- Comandos completos no [README](../README.md#importar-bares-do-openstreetmap-operador).

**Arquivos**: `scripts/import-osm.ts`, `scripts/lib/osm-import.ts`, `scripts/osm-import.test.ts`, `src/lib/overpass.ts`, `supabase/migrations/002_venues_external_id.sql`.

---

## 4. Toggle Mapa / Lista

- Dois botões no header: **Mapa** e **Lista**.
- **Mapa**: exibe o mapa (e sidebar com filtros/lista ao lado em desktop, ou ao abrir “Filtros”).
- **Lista**: em mobile a lista ocupa a tela; em desktop o mapa continua visível ao lado.
- Estado `viewMode`: `"map"` | `"list"`.

**Arquivos**: `src/app/page.tsx`.

---

## 5. Lista de bares

- Na **aba Lista** (mobile), o painel de filtros e a lista compartilham **um único scroll** na sidebar (`overflow-y-auto` no `aside`): o usuário pode arrastar a partir dos filtros ou dos cards — não só na faixa da lista.
- Lista de venues filtrados e ordenados no sidebar, limitada aos **bounds atuais do mapa** (com pequeno overscan para cobrir a área visível).
- Cada item mostra nome, menor preço (ou “—” quando não há preços), quantidade de cervejas ou “Preços não informados”, e tag de happy hour quando aplicável.
- Clique seleciona o bar e abre o bottom sheet; item selecionado destacado.

**Arquivos**: `src/components/VenueList.tsx`, `src/components/VenueCard.tsx`.

---

## 6. Bottom sheet (detalhes do bar)

Ao selecionar um bar no mapa ou na lista:

- **Nome** e **endereço completo** (endereço, bairro, cidade, estado).
- **Tags**: quantidade de cervejas servidas ou “Preços não informados”, “Happy hour” (se houver), até 3 preços exibidos como "Marca R$ X" ou "Tipo R$ X" quando não há marca.
- **Preço mínimo**: “A partir de R$ X,X” ou “—” quando não há preços.
- **Detalhes do happy hour**: exibidos quando existem (`happyHourDetails`).
- **Aviso “Preços não verificados”**: quando o bar foi adicionado por usuário (`userAdded`, “adicionado por um usuário”) ou teve preços/happy hour editados pela comunidade (`pricesUnverified`, vindo de `venues.prices_unverified`, “informados pela comunidade”). Persiste após recarregar a página (antes, para bares do OSM editados, só existia em memória).
- **Aviso “Dados do OpenStreetMap”**: quando o bar veio do OSM (`fromOsm === true`); sem preços, convida a adicionar; com preços, só credita a localização.
- **Aviso “Dados do Google Maps”**: quando o bar veio do Places (`fromGoogle === true`), mesmo padrão.
- **Sinalizar preços incorretos**: link discreto abaixo das ações (só quando o bar tem preços). Chama `POST /api/venues/[id]/report`; ao concluir mostra “Obrigado! Vamos revisar os preços deste bar.”. Erros (429, 403, rede) aparecem logo abaixo (`reportErrorMessage`).
- **Como chegar**: link que abre Google Maps com rota até o bar (destino = lat,lng).
- Fechar o sheet: toque fora (overlay escuro).
- **Ações** (Adicionar/Editar preços quando há callback, Como chegar): sempre em **uma linha** (`whitespace-nowrap`); em telas &lt; `sm` usam `text-xs`, padding menor e, se faltar largura, **scroll horizontal** discreto (scrollbar oculta); a partir de `sm`, `flex-1` divide o espaço com `text-sm`.

**Arquivos**: `src/components/VenueSheet.tsx`, `src/app/api/venues/[id]/report/route.ts`.

---

## 7. Adicionar bar

- Acesso pelo botão **“Adicionar bar”** na barra inferior.
- **Login obrigatório para cadastrar** (quando o login está configurado com `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`): sem sessão, o modal mostra só o card “Entre para cadastrar um novo bar” (“Para evitar spam, pedimos um login rápido antes de adicionar bares. Editar preços em bares existentes não exige login.”), sem citar o provedor de autenticação:
  - **Continuar com Google**: com `NEXT_PUBLIC_GOOGLE_CLIENT_ID` definido, mostra o botão oficial do Google (Google Identity Services, popup/FedCM, `locale` pt-BR) e entra com `signInWithIdToken({ provider: "google", token, nonce })`, sem sair da página; a janela do Google mostra o domínio do BrejaMap em vez de `<projeto>.supabase.co`. A cada tentativa é gerado um nonce aleatório: o Google recebe o SHA-256 (hex) e o Supabase recebe o nonce cru (`src/lib/google-identity.ts`). Se a variável não estiver definida, ou se o script `accounts.google.com/gsi/client` ou o Web Crypto não estiverem disponíveis (ex.: falha de rede, timeout de 10 s, HTTP fora de localhost), volta ao fluxo antigo: `signInWithOAuth`, que redireciona e volta para a origem do site; antes do redirecionamento grava uma flag em `sessionStorage` e, na volta, `page.tsx` reabre o modal.
  - **Continuar com e-mail**: envia o código (`signInWithOtp`) e mostra o campo do código de 6 dígitos (`verifyOtp`, sem sair da página); o link do mesmo e-mail também funciona.
  - Erros de login aparecem em pt-BR genérico (nunca o texto cru do provedor).
  - Rodapé do card: link “Política de privacidade” (`/privacidade`, abre em nova aba).
  - Logado: o formulário mostra “Conectado como {e-mail}” e o botão **Sair**; ao salvar, o `access_token` da sessão vai em `Authorization: Bearer` (`createVenue(venue, accessToken)`).
  - Sem as variáveis públicas o card não aparece (o formulário é mostrado) e o servidor responde 401 se o backend estiver configurado.
- Modal com formulário:
  - Nome do bar * (obrigatório)
  - **Onde fica o bar? \*** (`src/lib/venue-location.ts`, `src/lib/use-venue-location.ts`, `src/components/VenueLocationMap.tsx`, `src/components/VenueLocationSearch.tsx`): o local é escolhido num **mapa dentro do modal**, com um **pino fixo no centro**: o usuário arrasta o mapa (ou toca/clica num ponto, ou usa as setas do teclado) até o pino ficar no bar. O mapa abre no centro do mapa principal com zoom entre 17 e 19, com os pontos de interesse do Google visíveis para ajudar a achar a porta certa. O endereço exato **não é mais obrigatório**.
    - **Usar minha localização**: pede a geolocalização do aparelho só quando o usuário toca no botão (`enableHighAccuracy`, timeout 15 s); move o mapa para o ponto com zoom 18 e mostra a precisão (“Sua localização (precisão de ~25 m)”), com aviso para conferir o pino quando a precisão passa de 100 m. Permissão negada, timeout, navegador sem suporte, conexão sem https e localização fora de SP mostram mensagens em pt-BR sugerindo ajustar o pino ou buscar o endereço. Se o usuário mexer no mapa ou escolher um resultado antes da resposta, ela é descartada.
    - **Busca de endereço opcional** (“Buscar rua ou lugar (opcional)”): resultados listados dentro do formulário (sem dropdown flutuante; títulos longos quebram linha), primeiro perto do pino (ver seção 2), com a distância até o pino; navegação por setas, Enter e Esc (Esc fecha só a lista, não o modal); Enter no campo nunca envia o formulário. Sem resultado: “Nenhum endereço encontrado. Sem problema: arraste o mapa até o pino ficar no bar — o endereço é opcional.” Com resultados: “Não achou a rua certa? Ignore a busca e arraste o mapa até o bar.” Cada nova digitação cancela a requisição anterior (`AbortController`; se ainda estava na fila, nunca é enviada) e **esconde na hora** os resultados da busca anterior: durante o debounce e o carregamento a lista fica vazia (“Buscando endereços perto do mapa...”), Enter não escolhe nada e só respostas da busca atual são aplicadas (`src/lib/location-search.ts`). Ao escolher, o mapa vai até o ponto (zoom 18 para rua/local) e o endereço do resultado é usado direto.
    - **Prévia do local**: cartão abaixo do mapa com a origem do ponto (“Centro do mapa (ainda não ajustado)”, “Marcado no mapa”, “Resultado da busca”, “Sua localização”), rua, bairro · cidade - UF e as coordenadas com 6 casas decimais. O endereço vem da **geocodificação reversa** do Nominatim (`/reverse`, `zoom=18`, 700 ms depois de o mapa parar, pela mesma fila de 1 req/s; timeout de 10 s contando a espera na fila, depois o salvamento é liberado) e usa só rua + número, nunca o nome de um estabelecimento vizinho. Cada movimento do pino incrementa uma revisão: resposta atrasada de um ponto anterior é ignorada e a requisição é abortada. Ao mover o pino, os campos não digitados pelo usuário são **limpos na hora** (nunca fica a rua/cidade do ponto anterior); se a busca reversa falhar, aparece “Não conseguimos identificar o endereço deste ponto. O local vale mesmo assim” com “Tentar de novo”.
    - **Confirmar local**: o bar nunca é salvo silenciosamente no centro do mapa. O botão **Confirmar local** marca o ponto como confirmado (“✓ Local confirmado. Mexeu no mapa? Confirme de novo.”); qualquer movimento do pino desfaz a confirmação. Pontos fora do estado de SP não podem ser confirmados (mesma caixa do servidor, `isInsideSpState` em `src/lib/geo.ts`).
    - **Mapa indisponível** (sem chave, erro ou 12 s sem carregar): o modal mostra “O mapa não carregou” e o local precisa vir de “Usar minha localização” ou da busca (sem o mapa, o centro inicial não pode ser confirmado).
  - **Corrigir endereço (opcional)**: seção recolhível com Endereço, Bairro e Cidade preenchidos a partir do pino (ex.: para incluir o número). O que o usuário digita é mantido ao mover o pino; os demais campos acompanham o pino. Se o texto digitado diferir do endereço do pino, aparece “Usar o endereço do pino”. Escolher um resultado da busca substitui tudo. A UF vem do ponto (padrão `SP`) e, sem endereço, o servidor grava “Endereço não informado”.
  - Preços de cerveja *: lista dinâmica de entradas (tipo + marca + preço). Cada linha: dropdown de tipo (Chope, Long neck, Lata, Garrafa, Outro), campo "Marca" (ex.: Brahma, Heineken) e valor em R$ (teclado decimal no celular). No celular a linha tem tipo + preço + remover e a marca embaixo, em largura total; no desktop fica tudo numa linha. Botão "Adicionar cerveja" adiciona nova linha; cada linha pode ser removida (exceto a última). Ao menos uma entrada com preço > 0 é obrigatória. Permite múltiplas marcas por tipo (ex.: Chope Brahma e Chope Heineken).
  - Checkbox “Tem happy hour” + campo “Detalhes do happy hour”
- **Layout**: no celular o modal ocupa a tela como folha inferior (`100dvh`); no desktop é centralizado. O conteúdo rola e o rodapé com **Cancelar** / **Salvar bar** fica fixo, com o motivo de o botão estar desabilitado (“Informe o nome do bar.”, “Confirme o local do bar no mapa.”, “Aguarde o endereço do local...”, “Adicione ao menos um preço.”). `role="dialog"`, Esc fecha, e tocar fora fecha só se o toque começou fora (arrastar o mapa e soltar fora não fecha). O formulário é desmontado ao fechar, então cada abertura começa do zero.
- Ao salvar: o botão mostra "Salvando..."; o bar é criado via POST e adicionado à lista; preços aparecem como “não verificados” no detalhe. Se falhar, o erro aparece no modal (ex.: "Adicionar e editar bares está temporariamente desativado" quando a escrita está bloqueada em produção) e o formulário é mantido. O modal "Adicionar preços" segue o mesmo fluxo.

- **Adicionar/editar preços** (`AddPricesModal`): não exige login; se houver sessão, o token é enviado para registrar o autor. O bar passa a mostrar “Preços não verificados”.

**Arquivos**: `src/components/AddVenueModal.tsx`, `src/components/VenueLocationMap.tsx`, `src/components/VenueLocationSearch.tsx`, `src/lib/location-search.ts` (+ testes), `src/lib/venue-location.ts` (+ testes), `src/lib/use-venue-location.ts`, `src/lib/use-google-maps.ts` (carregador único do Google Maps, usado também por `Map.tsx`), `src/components/LoginCard.tsx`, `src/components/GoogleSignInButton.tsx`, `src/lib/google-identity.ts` (+ testes), `src/types/google-identity.d.ts`, `src/components/AddPricesModal.tsx`, `src/app/page.tsx`, `src/lib/use-venues-map.ts` (salvar bar/preços), `src/lib/api.ts` (`saveErrorMessage`), `src/lib/supabase-browser.ts`, `src/lib/use-auth-user.ts`, `src/lib/geocode.ts`.

---

## 8. Navegação inferior

- Barra fixa no rodapé com dois itens: **Mapa** e **Adicionar bar**.
- “Mapa” é apenas indicador visual (sem ação além do contexto atual da tela).
- “Adicionar bar” abre o modal de novo bar.

**Arquivos**: `src/app/page.tsx`.

---

## 9. Erros e compartilhamento

- **Error boundary** (`src/app/error.tsx`): se algo quebrar ao renderizar, aparece "Algo deu errado" com botão **Tentar de novo** em vez de tela em branco. Falhas do Google Maps continuam tratadas dentro de `Map.tsx` (mensagem + timeout de 12 s).
- **Metadados de compartilhamento** (`src/app/layout.tsx`): título, descrição, Open Graph e Twitter card em pt-BR; `metadataBase` usa `NEXT_PUBLIC_SITE_URL` ou, no Vercel, `VERCEL_PROJECT_PRODUCTION_URL`.
- **Imagem de compartilhamento** (`src/app/opengraph-image.png` + `.alt.txt`): card estático 1200×630 (usado por WhatsApp, Instagram, X). Para mudar, substitua o PNG.

**Arquivos**: `src/app/error.tsx`, `src/app/layout.tsx`, `src/app/opengraph-image.png`.

---

## 10. Política de privacidade (`/privacidade`)

- Página estática em pt-BR (`src/app/privacidade/page.tsx`, com título/descrição/canonical próprios), linkada no card de login. Também é a URL a cadastrar em Google Auth Platform → Branding.
- Descreve: conta de login no Supabase Auth (e-mail, id da conta e dados básicos de perfil do Google); autoria de bares/edições (`created_by`, `last_edited_by`, `last_edited_at`); contadores de rate limit com hash SHA-256 salgado de IP/id do usuário (IP cru nunca gravado; linhas apagadas a partir de 1 dia após expirar); geolocalização só no navegador (o servidor recebe apenas os limites do mapa); sessão no armazenamento local; terceiros (Google Maps/login, Nominatim, Supabase, Vercel); retenção e direitos (LGPD).
- Contato: `CONTACT_EMAIL` (variável só do servidor, lida no build). Sem ela, a página indica o e-mail de suporte exibido na janela de login do Google.
- Ao mudar coleta de dados (novas tabelas, analytics, uploads de foto), atualize o texto e a data `UPDATED_AT`.

**Arquivos**: `src/app/privacidade/page.tsx`, `src/components/LoginCard.tsx`.

---

## Modelo de dados (resumo)

- **Venue**: id, name, address, neighborhood, city, state, lat, lng, beerPrices (pode ser [] para lugares do Google), hasHappyHour, happyHourDetails?, photoUrl?, createdAt, userAdded?, pricesUnverified?, fromOsm?, fromGoogle?.
- **BeerPrice**: type (BeerType), label (marca/nome, ex.: "Brahma" ou "Chope" quando genérico), priceBRL, volumeMl?.
- **BeerType**: `"chope"` | `"long_neck"` | `"lata"` | `"garrafa"` | `"outro"`.
- **SortOption**: `"price_asc"` | `"price_desc"` | `"distance"` | `"name"`.

**Arquivos**: `src/types/index.ts`, `src/data/venues.ts`.

---

## Referências

- Comparação com MisterGoodBeer e prioridades para o Brasil: **MGB_FEATURES_AND_BRAZIL.md** na raiz do projeto.
- Configuração e scripts: **README.md** na raiz.
