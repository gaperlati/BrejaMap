# Configuração e execução local

## Requisitos

- **Node.js 24** (versão em `.nvmrc`; com nvm: `nvm use`).

## 1. Variáveis de ambiente

Copie `.env.example` para `.env.local` (lá estão todas as variáveis, com comentários). No Vercel, defina as mesmas em Project Settings → Environment Variables ou use `vercel env pull .env.local`. Só `SUPABASE_SERVICE_ROLE_KEY` é segredo: marque-a como secreta no Vercel. As variáveis `NEXT_PUBLIC_*` vão para o JavaScript do navegador de qualquer forma.

### Mapa (Google Maps)

Em [Google Cloud Console → Credenciais](https://console.cloud.google.com/apis/credentials), crie uma chave de API e ative a **Maps JavaScript API**. Defina `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

A chave fica visível no código do site, então restrinja-a:

- **Restrições do aplicativo → Sites**: o domínio de produção (ex.: `https://brejamap.vercel.app/*`) e `http://localhost:3000/*`.
- **Restrições de API**: só **Maps JavaScript API**. A busca de endereço usa o Nominatim, não o Google.

### Backend (Supabase)

Crie um projeto no [Supabase](https://supabase.com). Em Project Settings → API Keys:

- **Secret key** (`sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY` (só no servidor).
- **Publishable key** (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Project URL** → `SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_URL`.

Os nomes das variáveis vêm das chaves legadas (`service_role` e `anon`), que funcionam enquanto estiverem ativas. Prefira as chaves novas e desative as legadas em API Keys → Legacy API keys.

Rode, em ordem, os SQLs de `supabase/migrations/` no SQL Editor do Supabase:

1. `001_venues_and_beer_prices.sql`: tabelas.
2. `002_venues_external_id.sql`: coluna `external_id`, usada pela importação do OSM.
3. `003_atomic_venue_writes.sql`: funções `update_venue_and_prices` e `create_venue_with_prices`, que gravam bar e preços numa única transação.
4. `004_auth_rate_limits_and_moderation.sql`: autoria, rate limit, sinalização de preços e RLS em todas as tabelas.

Sem 003 e 004, adicionar bar, editar preços e sinalizar retornam 500. Todos podem ser rodados mais de uma vez, sempre nessa ordem.

A publishable key pode ir para o navegador porque a migração 004 liga RLS em todas as tabelas sem políticas para `anon`/`authenticated`: essa chave não lê nem grava nada direto no banco. Todos os dados passam pelas rotas `/api`, que usam a secret key no servidor.

### Login (para cadastrar bares)

Com `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` definidas, configure no painel do Supabase:

- Authentication → URL Configuration: coloque a URL do site (e `http://localhost:3000` para dev) em **Site URL** / **Redirect URLs**.
- Authentication → Providers → **Google**: ative e informe o Client ID/Secret criados no Google Cloud (OAuth, redirect `https://<projeto>.supabase.co/auth/v1/callback`).
- Authentication → Email Templates → **Magic Link**: inclua `{{ .Token }}` no texto para o e-mail trazer o código de 6 dígitos além do link (o modal aceita os dois).

Opcional: `NEXT_PUBLIC_GOOGLE_CLIENT_ID` faz o “Continuar com Google” usar o Google Identity Services, para a janela do Google mostrar o domínio do site em vez de `<projeto>.supabase.co` (detalhes no `.env.example`).

Sem essas variáveis, o card de login não aparece e criar bar responde 401 sempre que o backend estiver configurado. Editar preços e sinalizar preços não exigem login.

### Escrita em produção

Adicionar bar, editar preços e sinalizar preços ficam **bloqueados em produção** (403) até `USER_EDITS_ENABLED=true`. É o interruptor geral: voltar para `false` desliga todas as escritas na hora. Antes de ligar, aplique as migrações 003 e 004. Em `npm run dev` a escrita sempre funciona (mas criar bar continua exigindo login quando o backend está configurado).

### Anti-abuso

As escritas têm rate limit no Postgres (tabela `write_rate_limits`), por IP com hash SHA-256 + sal (`RATE_LIMIT_SALT`, opcional; padrão: a `SUPABASE_SERVICE_ROLE_KEY`). O IP nunca é gravado. Limites: editar preços 10/10 min por IP e 3/10 min por (IP, bar); criar bar 5/hora por usuário e por IP; sinalizar 5/10 min por IP. Ao exceder, a API responde 429 com `Retry-After`. Bares sinalizados ficam com `needs_review = true` (fila: `select * from venues where needs_review`).

## 2. Dados iniciais

Depois das migrações, importe os bares da cidade com o script do OpenStreetMap ([osm-import.md](./osm-import.md)). Não há bares de exemplo: o mapa mostra só o que está no banco.

## 3. Rodar

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Se o backend não estiver configurado, o mapa começa vazio; com o Supabase configurado, “Buscar bares” e o carregamento automático ao pan/zoom passam a usar o banco.

Antes de abrir um PR, rode `npm run lint`, `npm run test:scripts` e `npm run build`.
