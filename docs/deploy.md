# Deploy, operação e testes – BrejaMap

Produção: https://brejamap.vercel.app (Vercel, projeto ligado ao GitHub; todo merge em `master` publica). Banco: Supabase (projeto `marksrnjlviagfteprbd`).

---

## 1. Processo de deploy

1. **Migrações primeiro**. O código novo pode depender de funções/tabelas novas; o merge em `master` publica na hora. Ordem:
   1. Abra o PR e espere os checks (`npm run lint`, `npm run test:scripts`, `npm run test:db`, `npm run build`).
   2. Se o PR traz migração nova em `supabase/migrations/`, rode-a no **SQL Editor** do Supabase (ou `supabase db push`) **antes** do merge. Todas as migrações podem ser rodadas mais de uma vez.
   3. Faça o merge; a Vercel publica.
   4. Faça a verificação pós-deploy (seção 3).
2. **Banco novo do zero**: rode `001` a `005` em ordem e importe os bares do OSM (`npm run import:osm`, ver README). Não há mais seed de bares de exemplo.
3. **Variáveis** (Vercel → Settings → Environment Variables; lista comentada em `.env.example`): obrigatórias `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `USER_EDITS_ENABLED=true`. Opcionais: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `CONTACT_EMAIL`, `RATE_LIMIT_SALT`, `ADMIN_EMAILS`, `AI_GATEWAY_API_KEY`, `MENU_PHOTO_MODEL`, `MENU_PHOTO_DAILY_LIMIT`. Mudou variável → faça redeploy.
4. **Desligar escritas em emergência**: `USER_EDITS_ENABLED=false` + redeploy (o mapa continua no ar, só leitura).

### Pendências do rollout desta versão (migração 005)

- [x] Rodar `supabase/migrations/005_price_freshness_and_venue_tags.sql` em produção **antes** do merge do PR que a introduz (feito em 06/11/2026). Sem ela: o mapa carrega (sem datas nem avaliações), mas criar/editar bar, confirmar preço, favoritos e avaliações respondem 500.
- [ ] Supabase → Authentication → URL Configuration → **Redirect URLs**: incluir `https://brejamap.vercel.app/**` (o login pelo Google com redirecionamento e o link do e-mail agora podem voltar para `/conta`; sem isso o Supabase volta para a página inicial, e o login funciona do mesmo jeito).
- [ ] Opcional: `AI_GATEWAY_API_KEY` (Vercel → AI Gateway → API Keys) para ligar “Ler cardápio por foto”.
- [ ] Opcional: `ADMIN_EMAILS` com o(s) e-mail(s) de moderação para usar `/admin`.
- [ ] Opcional: ativar **Web Analytics** e **Speed Insights** no painel da Vercel (o código já está pronto).

---

## 2. Monitoramento

- **Erros de API (5xx)**: Vercel → projeto → **Logs**, filtrar por status `5xx` ou pelas mensagens `Supabase rpc ... error`, `AI Gateway answered ...`. Toda rota loga a causa no servidor e devolve só uma mensagem genérica ao cliente. `... not found: run supabase/migrations/...` indica migração faltando.
- **Falhas do mapa**: evento `map_load_error` no Vercel Web Analytics (Events), com `reason` = `script_error` (chave/restrição do Google Maps), `timeout` ou `missing_key`.
- **Desempenho**: Speed Insights (Web Vitals reais).
- **Uso do Supabase**: Supabase → Reports / Usage (banco, egress, Auth). Vale configurar alertas de uso no plano da conta (pendente, dono).
- **Custo da IA**: Vercel → AI Gateway → uso por modelo. O teto do app é `MENU_PHOTO_DAILY_LIMIT` (padrão 200 leituras/dia no site todo).
- **Moderação**: `/admin` (com `ADMIN_EMAILS`) ou `select id, name, last_edited_at from venues where needs_review order by last_edited_at desc nulls last;`.

---

## 3. Verificação pós-deploy (rápida)

1. `https://brejamap.vercel.app` abre o mapa; “Buscar bares” em São Carlos e em São Paulo carrega pins.
2. Abrir um bar com preço: aparecem “Atualizado há X dias” e “Ainda é esse preço?”.
3. `GET /api/venues?bounds=-22.05,-47.95,-21.98,-47.85` responde 200 com `venues` (preços com `id` e `updatedAt`).
4. `/conta` e `/privacidade` abrem; `/admin` mostra “Acesso restrito” para quem não é moderador.
5. Logs da Vercel sem 5xx novos.

---

## 4. Duplicatas do OpenStreetMap (São Paulo)

O ROADMAP lista 4 pares prováveis (mesmo nome, menos de 25 m). Desde esta versão o `GET /api/venues` já mostra cada par como **um só bar** (`collapseOsmNearDuplicates`), sem apagar nada. Apagar linhas no banco **não** é recomendado: a importação usa `ON CONFLICT (external_id) DO NOTHING`, então um elemento apagado volta na próxima importação.

Evidência coletada em 31/10/2026 (leitura em produção): Bar do Julião (8,1 m, mesma rua), Relica's - Rock & Bar (0 m, mesma rua), Boteco Ouzar (9,9 m, mesmo endereço) e Hocca Bar (23,6 m, sem endereço), nenhum com preço. São duplicatas reais do OSM e todas ficam abaixo dos 25 m da junção.

Para levantar evidências de novo (somente leitura):

```sql
select a.external_id as id_a, b.external_id as id_b, a.name,
       a.lat as lat_a, a.lng as lng_a, b.lat as lat_b, b.lng as lng_b,
       round((6371000 * sqrt(power(radians(b.lat - a.lat), 2)
         + power(radians(b.lng - a.lng) * cos(radians((a.lat + b.lat) / 2)), 2)))::numeric, 1) as metros,
       (select count(*) from beer_prices p where p.venue_id = a.id) as precos_a,
       (select count(*) from beer_prices p where p.venue_id = b.id) as precos_b
from venues a
join venues b on a.source = 'osm' and b.source = 'osm' and a.id < b.id
  and lower(btrim(a.name)) = lower(btrim(b.name))
  and abs(a.lat - b.lat) < 0.0005 and abs(a.lng - b.lng) < 0.0005
order by metros;
```

Se um dia for preciso unir de fato (ex.: um dos dois recebeu preços e o outro aparece separado em outra área), a decisão e a execução ficam com o operador do banco, conferindo cada par no openstreetmap.org.

---

## 5. Roteiro de teste manual (celular e desktop)

Os testes automatizados cobrem a lógica (filtros, horários, frescor, validação, handlers das rotas com dublês) e o SQL (PGlite), mas não a interface no navegador. Antes de anunciar uma versão, percorra:

- [ ] Mapa: abrir, permitir/negar localização, “Onde estou”, pan/zoom carregando pins, aviso de zoom em área densa.
- [ ] Busca de endereço no topo.
- [ ] Filtros: preço máximo, tipo, bairro, happy hour, aberto agora, futebol, reserva, área externa; ordenações (incluindo “Melhor avaliação”); lista vazia com “Adicionar bar”.
- [ ] Detalhe do bar: tags, preços com data, “Sim” (mensagem “Confirmado agora”), “Não, corrigir” abre o editor, horário recolhível, “Como chegar”, “Sinalizar preços incorretos”.
- [ ] Editar preços: mudar um preço e conferir que os outros mantêm a data; ml preservado; Sim/Não/Não sei; horário com virada da meia-noite.
- [ ] Adicionar bar: login (Google e código por e-mail), local no mapa + “Confirmar local”, preços, atributos, salvar.
- [ ] Ler cardápio por foto (com `AI_GATEWAY_API_KEY`): foto boa, foto sem cardápio, foto grande; conferir que nada é salvo sem “Salvar”.
- [ ] Minha conta: login, favoritar/desfavoritar no detalhe, lista em `/conta`, Remover, Sair.
- [ ] Avaliação: dar, trocar e remover nota; média só com 3+ notas.
- [ ] `/admin` com e sem `ADMIN_EMAILS`.
- [ ] `/privacidade` atualizada.
