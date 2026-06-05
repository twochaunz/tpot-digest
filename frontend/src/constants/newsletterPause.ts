export const NEWSLETTER_LAST_DATE = '2026-06-02'

export const NEWSLETTER_PAUSE_MESSAGE =
  'abridged tech is paused after the 5/30 weekend edition while i focus elsewhere. archives remain available through june 2.'

export function clampNewsletterDate(dateStr: string): string {
  return dateStr > NEWSLETTER_LAST_DATE ? NEWSLETTER_LAST_DATE : dateStr
}

export function isAfterNewsletterLastDate(dateStr: string): boolean {
  return dateStr > NEWSLETTER_LAST_DATE
}
