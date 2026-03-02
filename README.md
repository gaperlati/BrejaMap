# Cerveja Barato

Mapa de preços de cerveja para o estado de São Paulo. Encontre bares com os melhores preços, filtre por tipo, bairro e happy hour.

## Configuração

1. **Variáveis de ambiente**
   - Copie `.env.example` para `.env.local`
   - **Mapa**: em [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie uma chave e ative **Maps JavaScript API**. Defina `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
   - **Backend (bares no mapa)**: crie um projeto em [Supabase](https://supabase.com), em Settings → API copie URL e **service_role** key. Defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Rode o SQL em `supabase/migrations/001_venues_and_beer_prices.sql` no SQL Editor do Supabase.

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
