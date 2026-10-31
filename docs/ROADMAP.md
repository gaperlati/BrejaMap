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
- **Seed e deploy**: documentação para popular dados iniciais e processo de deploy em [deploy.md](./deploy.md)
- **Frescor de preços, atributos do bar, horário, favoritos, avaliações, foto do cardápio e moderação**: código pronto (ver seção “Pós-release” abaixo); dependem da migração `005` em produção

**Referência completa**: [features.md](./features.md)

---

## Pré-release

Checkpoint: app está deployável, estável e apresentável. Foco em qualidade, robustez e preparação para produção.

### Deploy e dados

- [x] Documentar processo de deploy: ordem migração → merge, variáveis, importação do OSM, verificação pós-deploy e emergência em [deploy.md](./deploy.md)
- [ ] Rodar a migração `005_price_freshness_and_venue_tags.sql` em produção **antes** do merge do PR que a traz e incluir `https://brejamap.vercel.app/**` nas Redirect URLs do Supabase (pendente, dono: acesso ao Supabase de produção); ver [deploy.md](./deploy.md)
- [x] Verificar variáveis de ambiente documentadas (ver `.env.example`): `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (README e plataforma de deploy)
- [x] Script offline de importação de bares do OpenStreetMap (`npm run import:osm`, só localização, sem preços; dry-run por padrão) — substitui a ideia de fallback Overpass em tempo de requisição; ver [features.md](./features.md) seção 3.3
- [x] Rodar a migração `002_venues_external_id.sql` e a importação de São Carlos (`--preset sao-carlos --write`) em produção, após revisão
- [x] Importação de São Paulo capital: preset `sao-paulo` com duas bboxes (núcleo + sul, cada uma ≤ 0,5°) e filtro pelo limite municipal do OSM (relação 298285), que descarta Osasco, Guarulhos, ABC etc. e grava a cidade sempre como “São Paulo”; `sao-carlos` também passou a filtrar pelo limite municipal (relação 297986); ver [features.md](./features.md) seção 3.3
- [x] Rodar a importação de São Paulo em produção (`--preset sao-paulo --write`, 29/10/2026): 1255 elementos do OSM, 682 bares gravados (todos sem preço, cidade “São Paulo”), 403 ignorados sem nome e 170 fora do município; segunda execução gravou 0 novos (682 já existiam). Produção ficou com 718 bares (682 OSM em São Paulo, 26 OSM em São Carlos, 10 de seed/usuários) e os 24 preços existentes intactos
- [x] Remover os bares fictícios do início do projeto (29/10/2026): apagados de produção os 6 bares de `supabase/seed.sql` (Bar do Zé, Boteco Vila Madalena, Cervejaria Pinheiros, Bar do Centro, Bar do Mané, Bar Central Campinas) e seus 14 preços; removidos também `supabase/seed.sql` e `MOCK_VENUES` (o app parte de lista vazia). Produção ficou com 713 bares (708 OSM + 5 cadastrados por usuários) e 12 preços
- [x] 4 prováveis duplicatas do OSM em São Paulo (elementos diferentes com o mesmo nome a menos de 25 m): Bar do Julião (`osm-node-12710135501` / `osm-way-1368086200`), Relica’s - Rock & Bar (`osm-node-13606982101` / `osm-node-13606984001`), Boteco Ouzar (`osm-node-4510838660` / `osm-node-4529885389`) e Hocca Bar (`osm-relation-4602956` / `osm-way-329033176`): o `GET /api/venues` passou a mostrar cada par OSM de mesmo nome a até 25 m como um só bar, sem apagar nada (apagar não adianta: a importação recriaria a linha). Evidência (leitura em produção, 31/10/2026): os 4 pares têm o mesmo nome e a mesma rua, distâncias de 8,1 m, 0 m, 9,9 m e 23,6 m e nenhum preço, ou seja, são duplicatas reais, todas cobertas pela junção. Consulta e orientação para o operador em [deploy.md](./deploy.md) seção 4
- [x] Revisar o limite de 500 bares por requisição em `GET /api/venues` antes da importação de São Paulo: resolvido com o corte priorizado e o aviso de zoom (ver item de áreas densas abaixo)
- [x] Escritas atômicas de bar + preços (`003_atomic_venue_writes.sql`): PATCH e POST usam funções Postgres transacionais via RPC; GET não expõe mais mensagens de erro do banco; ver [features.md](./features.md) seção 3.1
- [x] Rodar a migração `003_atomic_venue_writes.sql` em produção, após revisão
- [x] Auth + anti-abuso para reabilitar escritas (`004_auth_rate_limits_and_moderation.sql`): login (Google ou e-mail com código/link) obrigatório só para cadastrar bar; edição de preços anônima com rate limit por IP (hash) e por (IP, bar); preços editados pela comunidade ficam “não verificados”; botão “Sinalizar preços incorretos” (`needs_review`); RLS em todas as tabelas; ver [features.md](./features.md) seções 3.1, 6 e 7
- [x] Rodar a migração `004_auth_rate_limits_and_moderation.sql` em produção, configurar login (Google + template de e-mail com código) e as variáveis `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`; só então definir `USER_EDITS_ENABLED=true`
- [x] SMTP provisório via Gmail (30/10/2026): conta dedicada do BrejaMap com verificação em duas etapas e senha de app, configurada em Authentication → Emails → SMTP Settings (`smtp.gmail.com`, porta 465); o login por código funciona em produção. Limites: ~500 e-mails/dia, remetente `@gmail.com` e entregabilidade menor (pode cair em spam). A senha de app fica só no Supabase. Substituir pelo item abaixo antes do lançamento.
- [ ] Configurar SMTP próprio (definitivo) no Supabase Auth (Authentication → Emails → SMTP Settings): hoje todos os e-mails (código de 6 dígitos, link de login) saem do SMTP padrão do Supabase, que tem limite baixo de envios por hora, remetente genérico e entregabilidade ruim. Provedor escolhido: Resend. **Bloqueado: falta um domínio próprio**, pois `brejamap.vercel.app` não permite criar registros DNS (SPF/DKIM). Passos quando houver domínio: (1) comprar/definir o domínio e usar um subdomínio de envio (ex.: `mail.<dominio>`); (2) criar conta no Resend, adicionar o domínio e publicar os registros SPF, DKIM e DMARC; (3) gerar uma chave de API do Resend (guardar só no Supabase, nunca no git); (4) no Supabase, em Authentication → Emails → SMTP Settings, ativar SMTP personalizado com host `smtp.resend.com`, porta `465`, usuário `resend`, senha = chave de API, remetente (ex.: `no-reply@<dominio>`) e nome "BrejaMap"; (5) revisar o template do e-mail com o código de 6 dígitos e subir o limite de e-mails por hora do Auth; (6) testar o login por e-mail em produção e confirmar que o remetente e a entrega (caixa de entrada, não spam) estão corretos

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
- [x] Textos de ajuda redundantes removidos dos modais “Adicionar bar” e “Editar preços” (“Tipo, marca … Use ‘Adicionar cerveja’ para mais opções.” / “Informe os preços que você conhece…”); rótulos, validação e acessibilidade dos campos mantidos.
- [x] Chips do topo (Happy hour, Filtros, Buscar bares) quebram linha no celular em vez de cortar “Buscar bares” em 375 px (só CSS).
- [x] “Adicionar bar” com escolha do local no mapa: pino fixo no centro de um mapa dentro do modal (arrastar ou tocar), botão “Usar minha localização” (só com ação do usuário), busca de endereço opcional que procura primeiro perto do pino (~15 km) e só depois no estado todo, endereço/bairro/cidade preenchidos pelo ponto (geocodificação reversa) e confirmação obrigatória (“Confirmar local”) antes de salvar; o endereço exato deixa de ser obrigatório. Ver [features.md](./features.md) seção 7

### Qualidade

- [ ] Teste manual completo em mobile e desktop, seguindo o roteiro de [deploy.md](./deploy.md) seção 5 (a lógica e o SQL têm testes automatizados: `npm run test:scripts` e `npm run test:db`; a interface no navegador ainda não)
  - Parcial (29/10/2026, produção, desktop + viewport mobile no navegador): validação de login ao adicionar bar e cancelamento dos modais passaram; nenhuma escrita foi feita. Bares de São Paulo apareceram no mapa, mas a passagem não comprova que todos os 682 importados estão visíveis. Ainda não testados: persistência (salvar bar/preços), geolocalização, rotas e teclado em aparelho real.
- [x] Build de produção: `npm run build` sem erros críticos; verificar console no build de produção
- [x] Atualizar Next.js 14 → 15 (15.5.x, com as correções de segurança) e React 18 → 19; `params` das rotas dinâmicas agora é assíncrono (`await params` em `PATCH /api/venues/[id]`)

### Achados do teste com usuário (29/10/2026)

Prioridade em ordem. Só os itens marcados foram resolvidos.

- [x] **P0 — Filtro de tipo + preço máximo na mesma cerveja** (PR #20): o preço máximo precisa valer para a cerveja do tipo escolhido, e o menor preço exibido, a ordenação, os pinos e os cards devem usar essa mesma cerveja. Hoje “Garrafa ≤ R$ 10” inclui bares com garrafa a R$ 14,50/15,00 porque o chope custa R$ 7,90/8,20.
- [x] **P1 — Busca de cidade na aba Lista** (PR #21): ao escolher São Paulo, a lista continua mostrando São Carlos até voltar para a aba Mapa.
- [x] **P1 — Recuperar de filtros**: o chip “Filtros” mostra a quantidade de filtros ativos e o painel tem “Limpar filtros (N)”, que volta tudo ao padrão.
- [x] **P1 — Mobile: primeiros resultados empurrados para baixo**: na aba Lista do celular o painel de filtros fica recolhido até tocar em “Filtros” (no desktop continua visível).
- [x] **P1 — Mobile: chips do topo cortando “Buscar bares”** em 375 px (quebra de linha, só CSS).
- [x] **P1 — Clareza do preço exibido** (tipo filtrado no destaque do detalhe, PR #20; data de cada preço, “Atualizado há X dias”, nesta versão): deixar claro qual tipo/tamanho de cerveja corresponde ao preço mostrado e há quanto tempo foi informado (frescor de preços continua sendo a próxima feature depois das correções).
- [x] **P1 — Formatação de moeda consistente em pt-BR**: `formatBRL` (`R$ 7,90`, sempre dois decimais) em pinos, cards, detalhe, conta e moderação; a fonte do pino diminui para preços longos.
- [ ] **P1 — Ações do mapa mais diretas** (pendente: escolher e validar os rótulos com usuários): distinguir pesquisa de endereço, localização atual e busca de bares na área com rótulos curtos, sem novos parágrafos explicativos.
- [x] **P1 — Formulários sem instruções redundantes**: removidos os parágrafos explicativos dos formulários de preço; manter rótulos curtos.
- [ ] **P2 — Texto do local no “Adicionar bar”** (pendente: validar o novo texto com usuários): “Centro do mapa (ainda não ajustado)” vs. “Local confirmado” ainda confunde; simplificar o texto de estado do pino.

---

## Release

Checkpoint: app está no ar e acessível; equipe pode monitorar e reagir.

### Lançamento

- [x] Deploy em produção: Vercel, https://brejamap.vercel.app (HTTPS da Vercel)
- [ ] Domínio customizado (pendente, dono: escolher/comprar o domínio e configurar o DNS)
- [x] Analytics: Vercel Web Analytics + Speed Insights no código (sem cookies; política de privacidade atualizada). Pendente (dono): ativar os dois no painel da Vercel

### Pós-lançamento

- [x] Monitoramento: falhas do mapa viram o evento `map_load_error` no Web Analytics; erros 5xx das APIs logados com a causa (Vercel → Logs); roteiro de uso do Supabase e custo da IA em [deploy.md](./deploy.md) seção 2. Pendente (dono): alertas de uso no Supabase
- [x] Link para app em produção no README e docs

---

## Pós-release (v1.x / próximas features)

Backlog de features priorizadas com base em [MGB_FEATURES_AND_BRAZIL.md](../MGB_FEATURES_AND_BRAZIL.md) e necessidades do mercado brasileiro.

### Implementado nesta rodada (código pronto; depende da migração `005` em produção)

- [x] **Frescor de preços**: `beer_prices.updated_at` por preço (editar mantém a data dos preços que não mudaram), “Atualizado há X dias” no detalhe e no card, “Ainda é esse preço? Sim” (`POST /api/venues/[id]/confirm`, rate limit por IP e por IP+bar, id antigo → 404) e “Não, corrigir” (abre o editor). A data é a de entrada/confirmação no BrejaMap, não a de observação no bar. Renovação da moderação: uma edição que muda de fato os preços limpa `needs_review` (a correção responde ao “Sinalizar preços incorretos”; um novo relato liga de novo); salvar os mesmos preços, editar só atributos ou confirmar não limpa. Ver [features.md](./features.md) seção 11
- [x] **Foto do cardápio → preços**: `POST /api/menu-photo` (login, JPEG/PNG/WebP até 4 MB conferidos pela assinatura, rate limit por usuário/IP + teto diário do site) → Vercel AI Gateway (`google/gemini-2.5-flash-lite`, saída JSON estrita) → preços acrescentados ao formulário para revisão em Adicionar bar e Editar preços; a foto não é guardada. Pendente (dono): `AI_GATEWAY_API_KEY` no Vercel. Seção 15
- [x] **Transmite futebol**, **Aceita reserva** e **Área externa / terraço**: colunas opcionais (Sim/Não/não informado), editor, tags e filtros. Seção 12
- [x] **Aberto agora**: horário semanal por dia (fuso de São Paulo, virada da meia-noite), bloco no detalhe, tag e filtro. Seção 12
- [x] **Tags adicionais**: quantidade de cervejas (já derivada de `beerPrices.length`), área externa, futebol, reserva, horário e avaliação no card/detalhe
- [x] **Minha conta + Favoritos**: `/conta` (login, e-mail, sair, favoritos) e ♡ no detalhe; tabela `favorites` com RLS sem políticas. Seção 13
- [x] **Moderação**: `/admin` com a fila de bares sinalizados (“Preços conferidos” / “Dispensar alerta”), negado por padrão; liberado só para e-mails confirmados em `ADMIN_EMAILS`. Pendente (dono): definir `ADMIN_EMAILS`. Seção 16
- [x] **Avaliação (1–5)**: login, uma nota por usuário e bar; média exibida a partir de 3 notas; ordenação “Melhor avaliação”. Seção 14

### Pendentes que dependem de decisão ou parceria

- **Eventos / música ao vivo**: exige parceria com os bares (quem publica e mantém a agenda) antes de modelar dados; sem isso a informação ficaria velha.
- **Reserva de mesa de verdade**: idem (integração com sistemas de reserva dos bares). O filtro/tag “Aceita reserva” já existe.
- **Outras categorias (coquetel/caipirinha, vinho)**: decisão de produto em aberto. O app mede “a partir de R$” e os pins pelo menor preço de **cerveja**; misturar caipirinha ou vinho nesses números distorce a comparação. Falta decidir se viram uma categoria separada (com pins/filtros próprios) ou só uma lista informativa no detalhe.
- **Domínio próprio**: escolher/comprar o domínio.

## Notas

- Features de pós-release são listadas como backlog; especificações completas serão criadas quando priorizadas.
- Ordem de implementação pode ser ajustada conforme feedback de usuários e métricas pós-release.
- Algumas features (ex.: reserva de mesa, eventos) podem exigir parcerias ou integrações externas.
