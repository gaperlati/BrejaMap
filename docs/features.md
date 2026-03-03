# BrejaMap – Funcionalidades

Documentação das funcionalidades atuais do app. Atualizada conforme novas tarefas e features são implementadas.

---

## Visão geral

**BrejaMap** é um mapa de preços de cerveja para o estado de São Paulo. O usuário encontra bares com os melhores preços, filtra por tipo de bebida, bairro e happy hour, e alterna entre vista de mapa e lista.

- **Stack**: Next.js 14, React 18, TypeScript, Tailwind CSS, Google Maps JavaScript API. **Backend**: Supabase (Postgres) para venues e preços.
- **Dados**: o mapa e a lista de bares vêm do **nosso backend** (GET /api/venues por bounds). Não há mais chamadas ao Google Places no cliente; a latência e o payload são controlados pelo nosso banco. Mock inicial em memória quando o backend não está configurado.

---

## 1. Mapa (Google Maps)

- Mapa centralizado em São Paulo por padrão (`SAO_PAULO_CENTER`, zoom 13).
- **API**: Google Maps JavaScript API. Chave em `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (`.env.local`).
- **Marcadores em formato de preço**: balão “R$ X,X” com o menor preço do bar (vermelho; amarelo quando selecionado).
- Atualização de centro/zoom quando o usuário pesquisa endereço ou interage com o mapa.
- Exibição de um marcador adicional (azul) para o resultado da busca de endereço.
- Controle de zoom no canto inferior direito; “Como chegar” abre rotas no Google Maps.
- **Bounds reporting**: quando o zoom fica **< 12**, o mapa avisa o parent para **remover** os bares carregados da API da lista (permanecem só venues do mock e adicionados pelo usuário).
- **Carregamento automático ao pan/zoom**: quando o usuário **para** de arrastar ou dar zoom (evento **idle** do mapa) e o zoom é **≥ 12**, a app dispara uma busca ao **nosso backend** (GET /api/venues?bounds=...) após **2 s** de debounce. Não há chamadas ao Google Places no cliente.
- **Overscanning**: os bounds visíveis são expandidos em **25%** antes de enviar ao backend; a resposta traz bares um pouco fora da tela para micro-pans sem nova requisição.
- **Merge por ID**: resultados novos são **mesclados** aos já carregados (por ID). Até 300 venues em memória (evição ao ultrapassar).
- **Buscar bares no clique**: botão **“Buscar bares”** carrega imediatamente a área visível. Se o zoom for **< 12**, mostra “Dê mais zoom no mapa para buscar bares desta área”.
- **Cache**: até 30 regiões (chave = bounds arredondados); mesma área reutiliza o cache. **Cooldown**: 15 s entre requisições ao nosso API.

**Arquivos**: `src/components/Map.tsx`, `src/app/page.tsx`.

---

## 2. Pesquisar endereço

- Campo de busca no header: “Pesquisar endereço”.
- Busca com **Nominatim (OpenStreetMap)**; resultados em dropdown (debounce 400 ms).
- Ao selecionar um resultado: mapa centraliza no local e aplica zoom 15; marcador de busca é exibido.
- Placeholder configurável.

**Arquivos**: `src/components/AddressSearch.tsx`, `src/lib/geocode.ts`.

---

## 3. Filtros

- **Painel de filtros**: aberto pelo chip “Filtros” no header ou pela sidebar (desktop). O chip “Filtros” fica destacado quando há filtros ativos (indicador visual).
- **Chip “Buscar bares”**: carrega bares da **nossa API** (backend Supabase) na área visível (zoom ≥ 12). Carregamento automático ao pan/zoom (debounce 2 s). Se o backend não estiver configurado, mostra mensagem e permanecem só os bares mock.
- **Preço máximo (R$)**: filtra bares cujo menor preço seja ≤ valor (bares sem preços ficam de fora).
- **Tipo de cerveja**: filtra bares que tenham ao menos um preço daquele tipo (bares sem preços ficam de fora).
- **Bairro**, **Apenas happy hour**, **Ordenar**: como antes.

**Arquivos**: `src/components/FilterBar.tsx`, `src/components/FilterChips.tsx`, `src/app/page.tsx`, `src/lib/api.ts`.

---

## 3.1. Backend (Supabase) e fontes de dados

- **Fonte de pins no mapa**: o cliente **não** chama mais o Google Places. Ao pan/zoom (idle, zoom ≥ 12) ou ao clicar em “Buscar bares”, o frontend chama **GET /api/venues?bounds=south,west,north,east**. O Next.js consulta o Supabase (tabelas `venues` e `beer_prices`) e devolve um JSON enxuto com os venues na bounding box. Isso elimina a latência e o payload pesado do Places no cliente.
- **Persistência**: **POST /api/venues** (adicionar bar) e **PATCH /api/venues/[id]** (adicionar/editar preços e happy hour) gravam no Supabase. Se o backend não estiver configurado (503), o app usa apenas estado local (mock + edições em memória).
- **Schema**: `venues` (id, name, address, neighborhood, city, state, lat, lng, has_happy_hour, happy_hour_details, photo_url, created_at, user_added, source); `beer_prices` (id, venue_id, type, label, price_brl, volume_ml, created_at). Migração em `supabase/migrations/001_venues_and_beer_prices.sql`.
- **Sincronização futura**: workers ou Edge Functions podem popular/atualizar `venues` a partir do Google Places (ou outras fontes) de forma assíncrona; o mapa continua consultando apenas o nosso banco.
- **Zoom out**: quando o zoom fica **< 12**, os venues carregados da API são removidos da lista (permanecem mock e user-added).

---

## 3.2. Deploy e dados iniciais (evitar mapa vazio)

Ao publicar o app, o Supabase começa vazio. Opções para o usuário não ficar frustrado:

1. **Manter mock em produção** (comportamento atual): o app inicia com 6 bares em memória (`MOCK_VENUES`). Ao clicar em "Buscar bares", a API devolve vazia e esses bares continuam visíveis. Funciona, mas os dados são placeholder.
2. **Rodar o seed no deploy**: após criar o projeto no Supabase e rodar a migração, executar `supabase/seed.sql` no SQL Editor. Os mesmos 6 bares passam a existir no banco; "Buscar bares" em São Paulo/Campinas já retorna dados reais.
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

- Lista de venues filtrados e ordenados no sidebar.
- Cada item mostra nome, menor preço (ou “—” quando não há preços), quantidade de cervejas ou “Preços não informados”, e tag de happy hour quando aplicável.
- Clique seleciona o bar e abre o bottom sheet; item selecionado destacado.

**Arquivos**: `src/components/VenueList.tsx`, `src/components/VenueCard.tsx`.

---

## 6. Bottom sheet (detalhes do bar)

Ao selecionar um bar no mapa ou na lista:

- **Nome** e **endereço completo** (endereço, bairro, cidade, estado).
- **Tags**: quantidade de cervejas servidas ou “Preços não informados”, “Happy hour” (se houver), até 3 tipos com preço quando existirem.
- **Preço mínimo**: “A partir de R$ X,X” ou “—” quando não há preços.
- **Detalhes do happy hour**: exibidos quando existem (`happyHourDetails`).
- **Aviso “Preços não verificados”**: quando o bar foi adicionado por usuário (`userAdded === true`).
- **Aviso “Dados do OpenStreetMap”**: quando o bar veio do OSM (`fromOsm === true`).
- **Aviso “Dados do Google Maps”**: quando o bar veio do Places (`fromGoogle === true`).
- **Como chegar**: link que abre Google Maps com rota até o bar (destino = lat,lng).
- Botão “Ver mais” (fecha o sheet).

**Arquivos**: `src/components/VenueSheet.tsx`.

---

## 7. Adicionar bar

- Acesso pelo botão **“Adicionar bar”** na barra inferior.
- Modal com formulário:
  - Nome do bar * (obrigatório)
  - **Localização**: campo “Buscar endereço” que usa **Nominatim (OpenStreetMap)** para geocodificar; ao selecionar um resultado, preenche coordenadas (lat/lng) e os campos Endereço, Bairro, Cidade e Estado. Se o usuário não buscar endereço, usam-se as coordenadas do **centro atual do mapa** (não há mais campos Lat/Lng manuais).
  - Endereço, Bairro, Cidade, Estado (editáveis; podem vir preenchidos pela busca de localização)
  - Preços de cerveja *: um ou mais tipos (Chope, Long neck, Lata, Garrafa, Outro) com valor em R$
  - Checkbox “Tem happy hour” + campo “Detalhes do happy hour”
- Ao salvar: novo bar é criado com `id` (UUID), `createdAt`, `userAdded: true` e adicionado à lista em memória; preços aparecem como “não verificados” no detalhe.

**Arquivos**: `src/components/AddVenueModal.tsx`, `src/app/page.tsx`, `src/lib/geocode.ts`.

---

## 8. Navegação inferior

- Barra fixa no rodapé com três itens: **Mapa**, **Adicionar bar**, **Minha conta**.
- “Mapa” e “Minha conta” são apenas indicadores visuais (sem ação ainda).
- “Adicionar bar” abre o modal de novo bar.

**Arquivos**: `src/app/page.tsx`.

---

## Modelo de dados (resumo)

- **Venue**: id, name, address, neighborhood, city, state, lat, lng, beerPrices (pode ser [] para lugares do Google), hasHappyHour, happyHourDetails?, photoUrl?, createdAt, userAdded?, fromOsm?, fromGoogle?.
- **BeerPrice**: type (BeerType), label, priceBRL, volumeMl?.
- **BeerType**: `"chope"` | `"long_neck"` | `"lata"` | `"garrafa"` | `"outro"`.
- **SortOption**: `"price_asc"` | `"price_desc"` | `"distance"` | `"name"` (distance ainda não usado na UI).

**Arquivos**: `src/types/index.ts`, `src/data/venues.ts`.

---

## Referências

- Comparação com MisterGoodBeer e prioridades para o Brasil: **MGB_FEATURES_AND_BRAZIL.md** na raiz do projeto.
- Configuração e scripts: **README.md** na raiz.
