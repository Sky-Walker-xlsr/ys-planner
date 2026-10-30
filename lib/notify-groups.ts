/** Teilt die Einträge eines Users nach Zieladresse auf: Adresse des Ordners, sonst seine Standard-Adresse */
export function groupByAddress<T extends { plannerId: string }>(
  items: T[],
  fallback: string,
  overrideFor: (plannerId: string) => string | undefined,
) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const address = overrideFor(item.plannerId) ?? fallback
    groups.set(address, [...(groups.get(address) ?? []), item])
  }
  return groups
}
