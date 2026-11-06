/**
 * Display formatting shared by pins, cards, the detail sheet and forms (pt-BR).
 * Free of React imports so it can be tested with `node --test`.
 */

/** "R$ 7,90": always two decimals with a comma (prices are capped at R$ 500, no thousands). */
export function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}
