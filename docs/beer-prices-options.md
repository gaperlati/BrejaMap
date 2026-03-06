# Opções: múltiplas marcas de cerveja por bar

No Brasil é comum o bar ter várias marcas por tipo (ex.: Chope Brahma, Chope Heineken, Long neck Stella). O modelo atual permite apenas **um preço por tipo** por bar (um chope, uma long neck, etc.).

## Situação atual

- **Schema**: tabela `beer_prices` já tem `type`, `label`, `price_brl`, `volume_ml`. Ou seja, **já aceita** vários registros por bar (várias linhas com o mesmo `type` e `label` diferente).
- **UI**: os modais "Adicionar bar" e "Editar preços" usam uma **grade fixa** (Chope, Long neck, Lata, Garrafa, Outro) com um único valor por tipo. O `label` hoje é só o nome do tipo (ex. "Chope"), não a marca.
- **Exibição**: lista e sheet usam `beerTypeLabels[p.type]` e não mostram o `label`; além disso usam `p.type` como key, o que quebra se houver dois chopes.

---

## Opções

### 1. Múltiplas entradas por tipo (label = tipo + marca) — **recomendado**

- **Ideia**: Cada preço é uma linha: **tipo** (dropdown) + **marca/nome** (texto livre, ex. "Brahma", "Heineken") + **R$**. O bar pode ter quantas linhas quiser (Chope Brahma R$ 8, Chope Heineken R$ 12, Long neck Stella R$ 14, etc.).
- **Schema**: nenhuma alteração. Já existe `label`; passamos a usar como "marca" ou "tipo + marca" (ex. "Chope Brahma" ou tipo=chope + label="Brahma").
- **Formulários**: em vez de 5 campos fixos, uma **lista dinâmica** de linhas. Botão "Adicionar cerveja" adiciona uma linha (tipo + marca + preço). Cada linha pode ser removida.
- **Exibição**: em cards e sheet, mostrar cada item como "Marca R$ X" ou "Tipo Marca R$ X" (ex. "Chope Brahma R$ 8"). Usar índice (ou id quando existir) como key no React.
- **Filtros**: "Tipo de cerveja" continua filtrando por tipo (ex. "Chope" = bares que tenham ao menos um preço com tipo chope).
- **Preço mínimo**: continua o menor preço entre todos os itens do bar (para pin e "A partir de R$ X").
- **Prós**: reflete a realidade dos bares, sem migration, flexível (qualquer marca). **Contras**: um pouco mais de UI (lista em vez de grade).

### 2. Lista pré-definida de marcas

- **Ideia**: Tabela `beer_brands` (id, name) e `beer_prices.brand_id` (ou `brand` text). No formulário, dropdown de marcas + "Outro" com campo livre.
- **Prós**: dados mais padronizados, possível autocomplete. **Contras**: migration, manutenção da lista, menos flexível para marcas locais/novas. Melhor como evolução depois.

### 3. Um preço por tipo + campo opcional "marca"

- **Ideia**: Manter um único preço por tipo e adicionar campo opcional "marca" (ex. "Chope - Brahma R$ 8").
- **Contras**: continua só uma opção por tipo; não resolve "várias marcas de chope".

---

## Recomendações

- **Implementar a opção 1**:
  - Formulários (Add bar + Editar preços): lista de itens (tipo + marca + preço), com "Adicionar cerveja" e remover por linha.
  - Exibição: usar `label` de forma legível (ex. "Chope Brahma" quando tipo=chope e label="Brahma"; ou guardar label completo "Chope Brahma").
  - Filtros e preço mínimo: sem mudança de regra; apenas garantir que múltiplos preços por tipo entrem no cálculo e no filtro.

- **Opcional depois**: se fizer sentido, evoluir para sugestões de marcas (autocomplete a partir dos labels já cadastrados) ou para a opção 2 com tabela de marcas.

**Arquivos a alterar para a opção 1**: `AddVenueModal.tsx`, `AddPricesModal.tsx`, `VenueSheet.tsx`, `VenueCard.tsx` (e qualquer outro que liste `beerPrices`). Nenhuma migration necessária.

**Status**: A opção 1 foi implementada: formulários com lista dinâmica (tipo + marca + preço), exibição com label/marca nos cards e no sheet, filtros e preço mínimo inalterados.
