# BrejaMap – Funcionalidades

Documentação das funcionalidades atuais do app. Atualizada conforme novas tarefas e features são implementadas.

---

## Visão geral

**BrejaMap** é um mapa de preços de cerveja para o estado de São Paulo. O usuário encontra bares com os melhores preços, filtra por tipo de bebida, bairro e happy hour, e alterna entre vista de mapa e lista.

- **Stack**: Next.js 14, React 18, TypeScript, Tailwind CSS, Google Maps JavaScript API. **Backend**: Supabase (Postgres) para venues e preços.
- **Dados**: o mapa e a lista de bares vêm do **nosso backend** (GET /api/venues por bounds). Não há mais chamadas ao Google Places no cliente; a latência e o payload são controlados pelo nosso banco. Mock inicial em memória quando o backend não está configurado.

---

## 1. Mapa (Google Maps)

- Inicialização do mapa em 3 etapas: tenta localização do navegador (com consentimento), se falhar usa geolocalização aproximada por IP e, por último, usa fallback em São Carlos (`SAO_CARLOS_CENTER`, zoom 13).
- **API**: Google Maps JavaScript API. Chave em `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (`.env.local`).
- **Marcadores em formato de preço**: balão “R$ X,X” com o menor preço do bar (vermelho; amarelo quando selecionado).
- Atualização de centro/zoom quando o usuário pesquisa endereço ou interage com o mapa.
- Exibição de um marcador adicional (azul) para o resultado da busca de endereço.
- **Onde estou**: botão flutuante (📍) no mapa recentraliza com `navigator.geolocation` (zoom 14); em caso de negação/erro não mostra alerta (o usuário pode usar a busca de endereço).
- Área do mapa com altura mínima maior em telas pequenas (`min(52vh, 520px)`) para gestos de pan mais confortáveis no celular.
- **Mobile (um dedo no mapa)**: `gestureHandling: "greedy"` no Google Map (evita o modo *cooperative*, que exige dois dedos quando a página é rolável) e o container do mapa usa `touch-none` para o navegador não roubar o pan com `touch-action` de scroll.
- **Controles nativos:** `disableDefaultUI: true` e reabilitação só do zoom + tela cheia no desktop; **`cameraControl`**, rotação e pan legados ficam desligados (remove a pilha circular de pan/zoom do mapa vetorial que ainda aparecia no mobile).
- Zoom no canto inferior **direito** só no desktop; em **viewports ≤639px** zoom e tela cheia nativos ficam ocultos (pinça continua no celular).
- Botão **“Onde estou”** fica no canto **inferior esquerdo**, acima do crédito Google e da área segura, para não conflitar com os controles à direita no desktop.
- **Bounds reporting**: quando o zoom fica **< 12**, o mapa avisa o parent para **remover** os bares carregados da API da lista (permanecem só venues do mock e adicionados pelo usuário).
- **Carregamento automático ao pan/zoom**: durante o movimento a app atualiza apenas o “alvo” do carregamento (sem sincronizar center/zoom/re-render pesado); no evento `idle` ela faz um relatório final e o zoom **≥ 12** dispara a busca ao **nosso backend** (GET /api/venues?bounds=...) após **~150 ms** de debounce (sem cooldown fixo). Não há chamadas ao Google Places no cliente.
- **Overscanning**: os bounds visíveis são expandidos em **25%** antes de enviar ao backend; a resposta traz bares um pouco fora da tela para micro-pans sem nova requisição.
- **Merge por ID**: resultados novos são **mesclados** aos já carregados (por ID). Até 300 venues em memória (evição ao ultrapassar).
- **Deduplicação no estado do cliente**: após cada merge de resultados, o frontend também elimina duplicatas por nome+coordenada (com priorização de user-added, com preços e mais recente) para evitar itens repetidos na lista quando múltiplas buscas da mesma área retornam venues equivalentes.
- **Buscar bares no clique**: botão **“Buscar bares”** carrega imediatamente a área visível. Se o zoom for **< 12**, mostra “Dê mais zoom no mapa para buscar bares desta área”.
- **Cache**: até 30 regiões (chave = bounds arredondados); mesma área reutiliza o cache (sem cooldown fixo).

- **Barra inferior (Mapa / Adicionar bar)**: `viewportFit: "cover"` no layout para `env(safe-area-inset-bottom)` funcionar no iOS; classe `.safe-area-pb` em `globals.css` com `padding-bottom: max(0.75rem, env(...))`; shell da página usa `h-dvh` em vez de `100vh` para acompanhar a barra dinâmica do Safari.

**Arquivos**: `src/components/Map.tsx`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/geo.ts` (overscan de bounds).

---

## 2. Pesquisar endereço

- Campo de busca no header: “Pesquisar endereço”.
- Busca com **Nominatim (OpenStreetMap)**, restrita ao Brasil (`countrycodes=br`, resultados em pt-BR); resultados em dropdown (debounce 400 ms).
- Ao selecionar um resultado: mapa centraliza no local e aplica zoom 15; marcador de busca é exibido.
- Placeholder configurável.

**Arquivos**: `src/components/AddressSearch.tsx`, `src/lib/geocode.ts`.

---

## 3. Filtros

- **Chips** (header): Happy hour, Filtros (com indicador quando há filtros ativos), Buscar bares — sem rótulo textual extra ao lado do happy hour.
- **Painel de filtros**: aberto pelo chip “Filtros” no header ou pela sidebar (desktop). O chip “Filtros” fica destacado quando há filtros ativos (indicador visual).
- **Chip “Buscar bares”**: carrega bares da **nossa API** (backend Supabase) na área visível (zoom ≥ 12). Carregamento automático ao pan/zoom (debounce ~150 ms). Se o backend não estiver configurado, mostra mensagem e permanecem só os bares mock.
- **Preço máximo (R$)**: filtra bares cujo menor preço seja ≤ valor (bares sem preços ficam de fora).
- **Tipo de cerveja**: filtra bares que tenham ao menos um preço daquele tipo (bares sem preços ficam de fora).
- **Bairro**: lista os bairros dos bares visíveis (ignora vazios, ordem pt-BR).
- **Apenas happy hour**.
- **Ordenar**: Menor preço, Maior preço, **Mais perto** e Nome. "Mais perto" usa a última localização conhecida do usuário (navegador ou IP); sem ela, a distância é medida a partir do centro do mapa (`distanceKm` em `src/lib/geo.ts`).

**Arquivos**: `src/components/FilterBar.tsx`, `src/components/FilterChips.tsx`, `src/app/page.tsx`, `src/lib/api.ts`, `src/lib/geo.ts`.

---

## 3.1. Backend (Supabase) e fontes de dados

- **Fonte de pins no mapa**: o cliente **não** chama mais o Google Places. Ao pan/zoom (idle, zoom ≥ 12) ou ao clicar em “Buscar bares”, o frontend chama **GET /api/venues?bounds=south,west,north,east**. O Next.js consulta o Supabase (tabelas `venues` e `beer_prices`) e devolve um JSON enxuto com os venues na bounding box. Isso elimina a latência e o payload pesado do Places no cliente.
- **Deduplicação de venues no GET**: quando existem linhas repetidas no banco para o mesmo local (mesmo nome + coordenadas muito próximas), a API responde apenas uma entrada para evitar cards/pins duplicados. A priorização mantém, nessa ordem, venues adicionados por usuário, depois venues com preços e por fim o registro mais recente.
- **Persistência**: **POST /api/venues** (adicionar bar) e **PATCH /api/venues/[id]** (adicionar/editar preços e happy hour) gravam no Supabase. Se o backend não estiver configurado (503), o app usa apenas estado local (mock + edições em memória). Qualquer **outra falha** (403 com escrita desativada, 400, 500, rede) é mostrada no próprio modal e o modal continua aberto; o app não finge mais que salvou.
- **Validação no servidor** (`src/lib/venue-server.ts`, compartilhado pelas duas rotas):
  - GET: bounds precisam ser números finitos, ordenados, com no máximo **2°** por lado; resposta limitada a **500** venues.
  - POST: nome de 2–80 caracteres; lat/lng dentro do **estado de SP** (bbox aproximada); textos de endereço truncados em 200 caracteres.
  - Preços (POST e PATCH): até 20 itens; tipo válido; marca 1–60 caracteres; preço > 0 e ≤ **R$ 500** (arredondado a centavos); volume opcional ≤ 5000 ml.
  - PATCH: id precisa ser UUID; responde 404 se o bar não existe (antes de alterar qualquer coisa); erros ao apagar/inserir preços retornam 500.
  - POST: se os preços falharem ao gravar, o bar recém-criado é apagado (não fica bar sem preço).
  - Mensagens de erro do banco não são devolvidas ao cliente (só logadas no servidor).
- **Writes (produção)**: por segurança, operações de escrita podem ficar **bloqueadas em produção** até que Auth/RLS do Supabase esteja implementado. Para reabilitar, configure `USER_EDITS_ENABLED=true` no ambiente.
- **Schema**: `venues` (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, photo_url, created_at, user_added, source); `beer_prices` (id, venue_id, type, label, price_brl, volume_ml, created_at). Migração em `supabase/migrations/001_venues_and_beer_prices.sql`.
- **Sincronização futura**: workers ou Edge Functions podem popular/atualizar `venues` a partir do Google Places (ou outras fontes) de forma assíncrona; o mapa continua consultando apenas o nosso banco.
- **Zoom out**: quando o zoom fica **< 12**, os venues carregados da API são removidos da lista (permanecem mock e user-added).

---

## 3.2. Deploy e dados iniciais (evitar mapa vazio)

Ao publicar o app, o Supabase começa vazio. Opções para o usuário não ficar frustrado:

1. **Manter mock em produção** (comportamento atual): o app inicia com bares de exemplo em memória (`MOCK_VENUES`). Ao clicar em "Buscar bares", a API devolve vazia e esses bares continuam visíveis. Funciona, mas os dados são placeholder.
2. **Rodar o seed no deploy**: após criar o projeto no Supabase e rodar a migração, executar `supabase/seed.sql` no SQL Editor. Os mesmos bares de exemplo passam a existir no banco; "Buscar bares" em São Paulo/Campinas já retorna dados reais.
3. **Empty state amigável**: quando não há nenhum bar na região (lista vazia sem filtros), a lista exibe "Nenhum bar nesta região ainda. Seja o primeiro a adicionar!" e botão **Adicionar bar**, convidando o usuário a contribuir.
4. **Fallback Overpass (futuro)**: o backend pode, quando o Supabase retornar 0 venues para um bounds, chamar a API Overpass (OpenStreetMap) e devolver bares da região sem preços — o mapa sempre mostra algo.
5. **Google Places como fallback**: mesma ideia do Overpass, com custo de API e necessidade de ativar Places API no Google Cloud.

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
- **Aviso “Preços não verificados”**: quando o bar foi adicionado por usuário (`userAdded === true`).
- **Aviso “Dados do OpenStreetMap”**: quando o bar veio do OSM (`fromOsm === true`).
- **Aviso “Dados do Google Maps”**: quando o bar veio do Places (`fromGoogle === true`).
- **Como chegar**: link que abre Google Maps com rota até o bar (destino = lat,lng).
- Fechar o sheet: toque fora (overlay escuro).
- **Ações** (Adicionar/Editar preços quando há callback, Como chegar): sempre em **uma linha** (`whitespace-nowrap`); em telas &lt; `sm` usam `text-xs`, padding menor e, se faltar largura, **scroll horizontal** discreto (scrollbar oculta); a partir de `sm`, `flex-1` divide o espaço com `text-sm`.

**Arquivos**: `src/components/VenueSheet.tsx`.

---

## 7. Adicionar bar

- Acesso pelo botão **“Adicionar bar”** na barra inferior.
- Modal com formulário:
  - Nome do bar * (obrigatório)
  - **Localização**: campo “Buscar endereço” que usa **Nominatim (OpenStreetMap)** para geocodificar; ao selecionar um resultado, preenche coordenadas (lat/lng) e os campos Endereço, Bairro (suburb/neighbourhood/quarter do OSM), Cidade e Estado. O botão **Salvar bar** fica desabilitado até um endereço da lista ser selecionado (não há fallback para o centro do mapa e não há campos Lat/Lng manuais). Bairro/cidade ficam vazios quando o OSM não informa (sem mais o padrão "São Paulo").
  - Endereço, Bairro, Cidade, Estado (editáveis; podem vir preenchidos pela busca de localização)
  - Preços de cerveja *: lista dinâmica de entradas (tipo + marca + preço). Cada linha: dropdown de tipo (Chope, Long neck, Lata, Garrafa, Outro), campo "Marca" (ex.: Brahma, Heineken) e valor em R$. Botão "Adicionar cerveja" adiciona nova linha; cada linha pode ser removida (exceto a última). Ao menos uma entrada com preço > 0 é obrigatória. Permite múltiplas marcas por tipo (ex.: Chope Brahma e Chope Heineken).
  - Checkbox “Tem happy hour” + campo “Detalhes do happy hour”
- Ao salvar: o botão mostra "Salvando..."; o bar é criado via POST e adicionado à lista; preços aparecem como “não verificados” no detalhe. Se falhar, o erro aparece no modal (ex.: "Adicionar e editar bares está temporariamente desativado" quando a escrita está bloqueada em produção) e o formulário é mantido. O modal "Adicionar preços" segue o mesmo fluxo.

**Arquivos**: `src/components/AddVenueModal.tsx`, `src/components/AddPricesModal.tsx`, `src/app/page.tsx`, `src/lib/api.ts` (`saveErrorMessage`), `src/lib/geocode.ts`.

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

## Modelo de dados (resumo)

- **Venue**: id, name, address, neighborhood, city, state, lat, lng, beerPrices (pode ser [] para lugares do Google), hasHappyHour, happyHourDetails?, photoUrl?, createdAt, userAdded?, fromOsm?, fromGoogle?.
- **BeerPrice**: type (BeerType), label (marca/nome, ex.: "Brahma" ou "Chope" quando genérico), priceBRL, volumeMl?.
- **BeerType**: `"chope"` | `"long_neck"` | `"lata"` | `"garrafa"` | `"outro"`.
- **SortOption**: `"price_asc"` | `"price_desc"` | `"distance"` | `"name"`.

**Arquivos**: `src/types/index.ts`, `src/data/venues.ts`.

---

## Referências

- Comparação com MisterGoodBeer e prioridades para o Brasil: **MGB_FEATURES_AND_BRAZIL.md** na raiz do projeto.
- Configuração e scripts: **README.md** na raiz.
