export interface CategoryDef {
  key: string
  label: string
  color: string
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'context', label: 'Context', color: '#60A5FA' },
  { key: 'hot-take', label: 'Hot Take', color: '#F87171' },
  { key: 'signal-boost', label: 'Signal Boost', color: '#34D399' },
  { key: 'kek', label: 'Kek', color: '#C084FC' },
  { key: 'pushback', label: 'Pushback', color: '#FB923C' },
]

export const CATEGORY_MAP = new Map(CATEGORIES.map(c => [c.key, c]))

/** Lookup a category by key. Returns label and color, falling back to gray for legacy/unknown keys. */
export function getCategoryDef(key: string): { label: string; color: string } {
  const found = CATEGORY_MAP.get(key)
  if (found) return found
  return { label: key, color: '#9CA3AF' }
}
