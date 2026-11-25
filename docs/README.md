# Documentação – BrejaMap

Pasta de documentação do projeto. Mantida atualizada a cada nova tarefa ou funcionalidade.

Produção: [brejamap.vercel.app](https://brejamap.vercel.app).

## Conteúdo

| Documento | Descrição |
|-----------|-----------|
| [setup.md](./setup.md) | Configuração e execução local: Node 24, variáveis de ambiente, chaves do Google Maps e do Supabase, migrações e login |
| [osm-import.md](./osm-import.md) | Comandos do script de importação de bares do OpenStreetMap (operador) |
| [features.md](./features.md) | Funcionalidades atuais do app (mapa, busca, filtros, lista, detalhe do bar, adicionar bar, etc.) |
| [ROADMAP.md](./ROADMAP.md) | Roadmap e próximas features (pre-release, release, pós-release) |
| [beer-prices-options.md](./beer-prices-options.md) | Decisão de modelagem/UI para suportar múltiplas marcas de cerveja por bar (opções, recomendação e status). |
| [MGB_FEATURES_AND_BRAZIL.md](./MGB_FEATURES_AND_BRAZIL.md) | Comparação com o MisterGoodBeer e prioridades para o Brasil |

## Manutenção

- **Ao implementar uma nova feature**: atualize `docs/features.md` (nova seção ou alteração na existente).
- **Ao mudar comportamento relevante** (ex.: filtros, fluxo de adicionar bar, integrações): descreva a mudança em `features.md`.
- **Regra do projeto**: o `AGENTS.md` na raiz lembra os agentes de código de atualizar a documentação junto com o código.

## Estrutura sugerida para novas seções

Para novas funcionalidades em `features.md`:

1. Título (nível 2) com o nome da feature.
2. Descrição curta do que faz e onde aparece na UI.
3. Detalhes técnicos (estado, APIs, componentes).
4. Lista de arquivos principais (`**Arquivos**: ...`).
