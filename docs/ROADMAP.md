# BrejaMap – Roadmap

Roadmap do projeto com fases: estado atual, pré-release, release e pós-release.

---

## Estado atual (concluído)

O app já possui as funcionalidades essenciais para funcionar:

- **Mapa (Google Maps)** com marcadores de preço, busca por endereço (Nominatim), carregamento automático ao pan/zoom
- **Filtros**: preço máximo, tipo de cerveja, bairro, happy hour, ordenação
- **Lista e mapa**: toggle entre vistas, bottom sheet com detalhes do bar
- **Adicionar bar**: formulário com localização via mapa/endereço, múltiplas marcas de cerveja por tipo (tipo + marca + preço)
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
- [ ] Rodar a migração `002_venues_external_id.sql` e a importação de São Carlos (`--preset sao-carlos --write`) em produção, após revisão

### Polimento e robustez

- [x] Meta tags e Open Graph: título, descrição, imagem para compartilhamento em redes sociais (atualizar `src/app/layout.tsx`)
- [x] Error boundaries ou tratamento gracioso: map/API failures devem mostrar mensagem clara ao usuário, não tela em branco
- [x] "Minha conta" na navegação: oculto até pós-release (a barra inferior só tem Mapa e Adicionar bar)

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

### Alta prioridade (ordem ajustável)

- **Transmissão de futebol**: Filtro "Transmite futebol" e tag no venue. Schema: adicionar coluna booleana `transmits_football` em `venues` ou usar sistema de tags; adicionar filtro na UI e tag no sheet/card.
- **Bar reservável**: Filtro "Aceita reserva" / "Reservável" e tag. Mesmo padrão: coluna `accepts_reservations` ou tag; filtro + exibição.
- **Aberto/fechado (horário)**: Horários de funcionamento ou status "Aberto agora" / "Fechado". Schema: campo opcional `opening_hours` (JSON ou texto estruturado); exibir no sheet e opcionalmente filtrar por "Aberto agora".
- **Tags adicionais**: Terraço, quantidade de cervejas (pode ser derivado de `beerPrices.length`), etc. Exibir no sheet/card como tags visuais.

### Depois (auth e engajamento)

- **Minha conta + Favoritos**: Autenticação (Supabase Auth), tabela `favorites` ou similar, tela "Minha conta" com lista de favoritos. Exige RLS no Supabase e fluxo de login.
- **Avaliação (rating)**: Nota do bar quando houver dados (comunidade ou parceiros). Schema: tabela `ratings` ou coluna agregada; exibir no sheet e opcionalmente filtrar/ordenar.
- **Eventos / música ao vivo**: Fase 2, exige modelo de dados (tabela `events`?) e possível integração com estabelecimentos.
- **Outras categorias**: Coquetel/caipirinha, vinho. Pode ser novos tipos em `beer_prices` ou categoria separada no venue.

---

## Notas

- Features de pós-release são listadas como backlog; especificações completas serão criadas quando priorizadas.
- Ordem de implementação pode ser ajustada conforme feedback de usuários e métricas pós-release.
- Algumas features (ex.: reserva de mesa, eventos) podem exigir parcerias ou integrações externas.
