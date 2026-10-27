# BrejaMap

Mapa de preços de cerveja para o estado de São Paulo, com foco no interior (o mapa abre em São Carlos quando não há localização do usuário). Encontre bares com os melhores preços, filtre por tipo, bairro e happy hour.

## Configuração

1. **Variáveis de ambiente**
   - Copie `.env.example` para `.env.local` (lá estão todas as variáveis, com comentários). No Vercel, defina as mesmas em Project Settings → Environment Variables ou use `vercel env pull .env.local`.
   - **Mapa**: em [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie uma chave e ative **Maps JavaScript API**. Defina `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
   - **Backend (bares no mapa)**: crie um projeto em [Supabase](https://supabase.com), em Settings → API copie URL e **service_role** key. Defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Rode o SQL em `supabase/migrations/001_venues_and_beer_prices.sql` no SQL Editor do Supabase.

**Para publicar com dados iniciais**: depois da migração, rode também `supabase/seed.sql` no SQL Editor. Isso insere os bares de exemplo (São Paulo, Campinas e um template em Av. Faria Lima, 949). Sem o seed, o mapa começa com os bares mock em memória até a primeira busca; com o seed, "Buscar bares" já devolve dados reais do banco.

   - **Escrita em produção**: adicionar bar/editar preços fica **bloqueado em produção** (403) até `USER_EDITS_ENABLED=true`. Em `npm run dev` a escrita sempre funciona.

2. Instale e rode:

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Se o backend não estiver configurado, o mapa mostra apenas os bares mock; ao configurar Supabase, “Buscar bares” e o carregamento automático ao pan/zoom passam a usar o banco.

## Funcionalidades

- **Mapa (Google Maps)** com marcadores em formato de preço (balão “R$ X,X”)
- **Bares no mapa**: carregamento automático ao pan/zoom (debounce 2 s) ou botão “Buscar bares”; dados vêm do **nosso backend** (Supabase), não do Google Places no cliente
- **Pesquisar endereço** para centralizar o mapa
- **Filtros**: preço máximo, tipo de cerveja, bairro, happy hour
- **Toggle Mapa / Lista**, **bottom sheet** ao clicar em um bar, **Adicionar bar** e **Adicionar/editar preços** (persistem no backend quando configurado)

**Documentação**: pasta [docs/](docs/). Ver **MGB_FEATURES_AND_BRAZIL.md** para comparação com MisterGoodBeer.
