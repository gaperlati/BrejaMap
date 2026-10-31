# Documentação – BrejaMap

Pasta de documentação do projeto. Mantida atualizada a cada nova tarefa ou funcionalidade.

App em produção: https://brejamap.vercel.app

## Requisitos e execução local

- **Node.js**: o projeto exige **Node 18.18+** (exigência do Next.js 15) (recomendado **Node 20**). Com Node 12 o `npm install` falha e o comando `next` não é encontrado.
- **Instalar dependências**: `npm install` (após usar Node 18+ ou 20).
- **Desenvolvimento**: `npm run dev` → http://localhost:3000
- **Build para produção**: `npm run build` e depois `npm run start`
- **Testes**: `npm run test:scripts` (lógica pura e handlers das rotas, com dublês) e `npm run test:db` (migrações e funções SQL num Postgres em memória, PGlite)

Se você ainda usa Node 12, instale Node 20 (por exemplo via [nodejs.org](https://nodejs.org/) ou nvm: `nvm install 20 && nvm use 20`), apague `node_modules` e rode `npm install` de novo.

## Conteúdo

| Documento | Descrição |
|-----------|-----------|
| [features.md](./features.md) | Funcionalidades atuais do app (mapa, busca, filtros, lista, detalhe do bar, adicionar bar, etc.) |
| [ROADMAP.md](./ROADMAP.md) | Roadmap e próximas features (pre-release, release, pós-release) |
| [deploy.md](./deploy.md) | Processo de deploy: ordem migração → código, variáveis, verificação pós-deploy, monitoramento e roteiro de teste manual. |
| [beer-prices-options.md](./beer-prices-options.md) | Decisão de modelagem/UI para suportar múltiplas marcas de cerveja por bar (opções, recomendação e status). |

## Manutenção

- **Ao implementar uma nova feature**: atualize `docs/features.md` (nova seção ou alteração na existente).
- **Ao mudar comportamento relevante** (ex.: filtros, fluxo de adicionar bar, integrações): descreva a mudança em `features.md`.
- **Regra do projeto**: as convenções (incluindo manter esta documentação junto com o código) ficam em `AGENTS.md`, na raiz do repositório.

## Estrutura sugerida para novas seções

Para novas funcionalidades em `features.md`:

1. Título (nível 2) com o nome da feature.
2. Descrição curta do que faz e onde aparece na UI.
3. Detalhes técnicos (estado, APIs, componentes).
4. Lista de arquivos principais (`**Arquivos**: ...`).
