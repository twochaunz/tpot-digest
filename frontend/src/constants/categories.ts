export interface CategoryDef {
  key: string
  label: string
  color: string
  sortOrder: number
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'context', label: 'context', color: '#60A5FA', sortOrder: 1 },
  { key: 'kek', label: 'kek', color: '#C084FC', sortOrder: 2 },
  { key: 'echo', label: 'echo', color: '#34D399', sortOrder: 3 },
  { key: 'pushback', label: 'pushback', color: '#FB923C', sortOrder: 4 },
  { key: 'hot-take', label: 'hot take', color: '#F87171', sortOrder: 5 },
]

export const CATEGORY_MAP = new Map(CATEGORIES.map(c => [c.key, c]))

/** Lookup a category by key. Returns label, color, and sortOrder, falling back to gray for legacy/unknown keys. */
export function getCategoryDef(key: string): { label: string; color: string; sortOrder: number } {
  const found = CATEGORY_MAP.get(key)
  if (found) return found
  return { label: key, color: '#9CA3AF', sortOrder: 999 }
}
