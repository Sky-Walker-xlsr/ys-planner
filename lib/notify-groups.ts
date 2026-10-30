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

export type DueWhen = 'today' | 'tomorrow'

/** Betreff und Text der Fälligkeits-Mail; heute Fälliges steht zuerst */
export function dueMail<T extends { title: string; when: DueWhen }>(items: T[], dates: { today: string; tomorrow: string }) {
  const today = items.filter((i) => i.when === 'today')
  const tomorrow = items.filter((i) => i.when === 'tomorrow')
  const ordered = [...today, ...tomorrow]
  const label = (when: string, list: T[]) => (list.length === 1 ? `${when} fällig: ${list[0].title}` : `${when} fällig: ${list.length} Einträge`)
  if (today.length && tomorrow.length) {
    return {
      subject: `Fällig: ${today.length} heute, ${tomorrow.length} morgen`,
      heading: `Heute und morgen fällig (${dates.today} und ${dates.tomorrow})`,
      paragraphs: ['Diese Aufgaben und Abschnitte sind dir zugewiesen und heute oder morgen fällig:'],
      items: ordered,
    }
  }
  const isToday = today.length > 0
  return {
    subject: isToday ? label('Heute', today) : label('Morgen', tomorrow),
    heading: isToday ? `Heute fällig (${dates.today})` : `Morgen fällig (${dates.tomorrow})`,
    paragraphs: [`Diese Aufgaben und Abschnitte sind dir zugewiesen und ${isToday ? 'heute' : 'morgen'} fällig:`],
    items: ordered,
  }
}
