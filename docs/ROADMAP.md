# BrejaMap – Roadmap

Roadmap do projeto com fases: estado atual, pré-release, release e pós-release.

---

## Estado atual (concluído)

O app já possui as funcionalidades essenciais para funcionar:

- **Mapa (Google Maps)** com marcadores de preço, busca por endereço (Nominatim), carregamento automático ao pan/zoom
- **Filtros**: preço máximo, tipo de cerveja, bairro, happy hour, ordenação
- **Lista e mapa**: toggle entre vistas, bottom sheet com detalhes do bar
- **Adicionar bar**: formulário com local escolhido no mapa (pino + confirmação), localização do aparelho ou busca de endereço opcional, múltiplas marcas de cerveja por tipo (tipo + marca + preço)
- **Editar preços**: adicionar/editar preços de cerveja com múltiplas opções por bar
- **Backend Supabase**: persistência de venues e beer_prices, API REST
- **Empty state amigável**: mensagem e CTA quando não há bares na região
- **Seed e deploy**: documentação para popular dados iniciais

**Referência completa**: [features.md](./features.md)

---

## Pré-release

Checkpoint: app está deployável, estável e apresentável. Foco em qualidade, robustez e preparação para produção.

### Deploy e dados

- [ ] Documentar processo de deploy: rodar migração + seed no Supabase (dashboard ou CI/CD) para produção ter dados iniciais
- [x] Verificar variáveis de ambiente documentadas (ver `.env.example`): `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (README e plataforma de deploy)
- [x] Script offline de importação de bares do OpenStreetMap (`npm run import:osm`, só localização, sem preços; dry-run por padrão) — substitui a ideia de fallback Overpass em tempo de requisição; ver [features.md](./features.md) seção 3.3
- [x] Rodar a migração `002_venues_external_id.sql` e a importação de São Carlos (`--preset sao-carlos --write`) em produção, após revisão
- [x] Importação de São Paulo capital: preset `sao-paulo` com duas bboxes (núcleo + sul, cada uma ≤ 0,5°) e filtro pelo limite municipal do OSM (relação 298285), que descarta Osasco, Guarulhos, ABC etc. e grava a cidade sempre como “São Paulo”; `sao-carlos` também passou a filtrar pelo limite municipal (relação 297986); ver [features.md](./features.md) seção 3.3
- [x] Rodar a importação de São Paulo em produção (`--preset sao-paulo --write`, 29/10/2026): 1255 elementos do OSM, 682 bares gravados (todos sem preço, cidade “São Paulo”), 403 ignorados sem nome e 170 fora do município; segunda execução gravou 0 novos (682 já existiam). Produção ficou com 718 bares (682 OSM em São Paulo, 26 OSM em São Carlos, 10 de seed/usuários) e os 24 preços existentes intactos
- [ ] Revisar 4 prováveis duplicatas do OSM em São Paulo (elementos diferentes com o mesmo nome a menos de 25 m): Bar do Julião (`osm-node-12710135501` / `osm-way-1368086200`), Relica’s - Rock & Bar (`osm-node-13606982101` / `osm-node-13606984001`), Boteco Ouzar (`osm-node-4510838660` / `osm-node-4529885389`) e Hocca Bar (`osm-relation-4602956` / `osm-way-329033176`)
- [x] Revisar o limite de 500 bares por requisição em `GET /api/venues` antes da importação de São Paulo: resolvido com o corte priorizado e o aviso de zoom (ver item de áreas densas abaixo)
- [x] Escritas atômicas de bar + preços (`003_atomic_venue_writes.sql`): PATCH e POST usam funções Postgres transacionais via RPC; GET não expõe mais mensagens de erro do banco; ver [features.md](./features.md) seção 3.1
- [x] Rodar a migração `003_atomic_venue_writes.sql` em produção, após revisão
- [x] Auth + anti-abuso para reabilitar escritas (`004_auth_rate_limits_and_moderation.sql`): login (Google ou e-mail com código/link) obrigatório só para cadastrar bar; edição de preços anônima com rate limit por IP (hash) e por (IP, bar); preços editados pela comunidade ficam “não verificados”; botão “Sinalizar preços incorretos” (`needs_review`); RLS em todas as tabelas; ver [features.md](./features.md) seções 3.1, 6 e 7
- [x] Rodar a migração `004_auth_rate_limits_and_moderation.sql` em produção, configurar login (Google + template de e-mail com código) e as variáveis `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`; só então definir `USER_EDITS_ENABLED=true`

### Polimento e robustez

- [x] Favicon próprio: caneca de cerveja escura com espuma clara sobre fundo âmbar, em SVG e ICO, com ícone para atalhos no iOS.
- [x] Corrigir “Buscar bares” para consultar bounds/zoom do mapa ao vivo por callback, com limpeza do handle ao desmontar e reinicialização dos relatórios ao remontar.
- [x] Refatorar `src/app/page.tsx` em hooks focados (`src/lib/use-venues-map.ts`, `src/lib/use-venue-filters.ts`) e helpers puros testados (`src/lib/venue-state.ts`), sem mudança de comportamento
- [x] Meta tags e Open Graph: título, descrição, imagem para compartilhamento em redes sociais (atualizar `src/app/layout.tsx`)
- [x] Error boundaries ou tratamento gracioso: map/API failures devem mostrar mensagem clara ao usuário, não tela em branco
- [x] "Minha conta" na navegação: oculto até pós-release (a barra inferior só tem Mapa e Adicionar bar)
- [x] Busca de endereço (Nominatim) com rótulos limpos, deduplicação, priorização de SP + proximidade e zoom dinâmico por tipo de local.
- [x] Agrupamento inteligente (clustering) de marcadores no mapa priorizando o menor preço e pinos compactos para bares sem preço.
- [x] Remoção do fallback de geolocalização por IP que movia o mapa para São Paulo capital após 8 segundos.
- [x] GET `/api/venues` pronto para áreas densas (ex.: ~700 bares na capital): preços embutidos na consulta (sem URL gigante de ids), corte em 500 priorizando bares com preço, depois adicionados por usuários e depois os mais próximos do centro, campo `truncated` e aviso “Dê mais zoom para ver todos os bares desta área”; ver [features.md](./features.md) seção 3.1
- [x] Login com Google via Google Identity Services + `signInWithIdToken` (a janela do Google mostra o domínio do BrejaMap, não `supabase.co`), com fallback para o redirecionamento OAuth; página `/privacidade`. Pendente (dono): origens JavaScript autorizadas e Branding no Google Cloud, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` no Vercel.
- [x] “Adicionar bar” com escolha do local no mapa: pino fixo no centro de um mapa dentro do modal (arrastar ou tocar), botão “Usar minha localização” (só com ação do usuário), busca de endereço opcional que procura primeiro perto do pino (~15 km) e só depois no estado todo, endereço/bairro/cidade preenchidos pelo ponto (geocodificação reversa) e confirmação obrigatória (“Confirmar local”) antes de salvar; o endereço exato deixa de ser obrigatório. Ver [features.md](./features.md) seção 7

### Qualidade

- [ ] Teste manual completo: adicionar bar, editar preços, busca, filtros, empty state em mobile e desktop
- [x] Build de produção: `npm run build` sem erros críticos; verificar console no build de produção
- [x] Atualizar Next.js 14 → 15 (15.5.x, com as correções de segurança) e React 18 → 19; `params` das rotas dinâmicas agora é assíncrono (`await params` em `PATCH /api/venues/[id]`)

---

## Release

Checkpoint: app está no ar e acessível; equipe pode monitorar e reagir.

### Lançamento

- [ ] Deploy em produção (Vercel, Netlify ou plataforma escolhida)
- [ ] Domínio customizado e HTTPS configurado (se aplicável)
- [ ] Opcional: analytics (Vercel Analytics ou Google Analytics) para medir uso sem bloquear lançamento

### Pós-lançamento

- [ ] Monitoramento: uso do Supabase, erros de API (5xx), falhas de carregamento do mapa
- [ ] Link para app em produção no README e docs

---

## Pós-release (v1.x / próximas features)

Backlog de features priorizadas com base em [MGB_FEATURES_AND_BRAZIL.md](../MGB_FEATURES_AND_BRAZIL.md) e necessidades do mercado brasileiro.

### Próximas features (prioridade máxima)

1. **Frescor de preços ("atualizado há X dias" + confirmação "Ainda é esse preço?")**: coluna `updated_at` nos preços, rótulo "atualizado há X dias" no sheet/card e botão "Ainda é esse preço? Sim/Não" para a comunidade confirmar ou corrigir.
2. **Foto do cardápio → preços (extração via IA com confirmação no formulário)**: o usuário envia uma foto do cardápio, a IA (via Vercel AI Gateway) extrai `{tipo, marca, preço}` e o formulário de preços já vem preenchido para o usuário revisar e confirmar.

### Alta prioridade (ordem ajustável)

- **Transmissão de futebol**: Filtro "Transmite futebol" e tag no venue. Schema: adicionar coluna booleana `transmits_football` em `venues` ou usar sistema de tags; adicionar filtro na UI e tag no sheet/card.
- **Bar reservável**: Filtro "Aceita reserva" / "Reservável" e tag. Mesmo padrão: coluna `accepts_reservations` ou tag; filtro + exibição.
- **Aberto/fechado (horário)**: Horários de funcionamento ou status "Aberto agora" / "Fechado". Schema: campo opcional `opening_hours` (JSON ou texto estruturado); exibir no sheet e opcionalmente filtrar por "Aberto agora".
- **Tags adicionais**: Terraço, quantidade de cervejas (pode ser derivado de `beerPrices.length`), etc. Exibir no sheet/card como tags visuais.

### Depois (auth e engajamento)

- **Minha conta + Favoritos**: tabela `favorites` ou similar, tela "Minha conta" com lista de favoritos. Login (Supabase Auth) e RLS já existem desde a migração 004; falta a tela e as políticas da nova tabela.
- **Moderação**: tela/admin para revisar bares com `needs_review` (hoje a fila é consultada direto no banco).
- **Avaliação (rating)**: Nota do bar quando houver dados (comunidade ou parceiros). Schema: tabela `ratings` ou coluna agregada; exibir no sheet e opcionalmente filtrar/ordenar.
- **Eventos / música ao vivo**: Fase 2, exige modelo de dados (tabela `events`?) e possível integração com estabelecimentos.
- **Outras categorias**: Coquetel/caipirinha, vinho. Pode ser novos tipos em `beer_prices` ou categoria separada no venue.

---

## Notas

- Features de pós-release são listadas como backlog; especificações completas serão criadas quando priorizadas.
- Ordem de implementação pode ser ajustada conforme feedback de usuários e métricas pós-release.
- Algumas features (ex.: reserva de mesa, eventos) podem exigir parcerias ou integrações externas.
