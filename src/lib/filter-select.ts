export interface SelectOption {
  value: string;
  label: string;
}

/** Match accents and repeated-key cycling as a native select does. */
export function findSelectMatch(options: SelectOption[], query: string, current: number): number {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const normalized = normalize(query);
  const repeated = [...normalized].every((character) => character === normalized[0]);
  const prefix = repeated ? normalized[0] : normalized;
  if (!prefix) return current;
  const start = repeated ? current + 1 : current;
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (Math.max(0, start) + offset) % options.length;
    if (normalize(options[index].label).startsWith(prefix)) return index;
  }
  return current;
}

export function getSelectPlacement(
  rect: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  optionCount: number,
) {
  const margin = 8;
  const gap = 6;
  const below = Math.max(0, viewport.height - rect.bottom - gap - margin);
  const above = Math.max(0, rect.top - gap - margin);
  const desiredHeight = Math.min(288, optionCount * 40 + 8);
  const openAbove = below < desiredHeight && above > below;
  const width = Math.min(rect.width, Math.max(0, viewport.width - margin * 2));
  return {
    left: Math.max(margin, Math.min(rect.left, viewport.width - width - margin)),
    width,
    maxHeight: Math.min(288, openAbove ? above : below),
    ...(openAbove ? { bottom: viewport.height - rect.top + gap } : { top: rect.bottom + gap }),
  };
}
