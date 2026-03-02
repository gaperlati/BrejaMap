# Documentação – Cerveja Barato

Pasta de documentação do projeto. Mantida atualizada a cada nova tarefa ou funcionalidade.

## Conteúdo

| Documento | Descrição |
|-----------|-----------|
| [features.md](./features.md) | Funcionalidades atuais do app (mapa, busca, filtros, lista, detalhe do bar, adicionar bar, etc.) |

## Manutenção

- **Ao implementar uma nova feature**: atualize `docs/features.md` (nova seção ou alteração na existente).
- **Ao mudar comportamento relevante** (ex.: filtros, fluxo de adicionar bar, integrações): descreva a mudança em `features.md`.
- **Regra do projeto**: existe uma regra em `.cursor/rules/` para lembrar de atualizar a documentação junto com o código.

## Estrutura sugerida para novas seções

Para novas funcionalidades em `features.md`:

1. Título (nível 2) com o nome da feature.
2. Descrição curta do que faz e onde aparece na UI.
3. Detalhes técnicos (estado, APIs, componentes).
4. Lista de arquivos principais (`**Arquivos**: ...`).
