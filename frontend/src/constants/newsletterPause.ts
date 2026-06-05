export const NEWSLETTER_LAST_DATE = '2026-06-02'

export const NEWSLETTER_PAUSE_MESSAGE =
  'Abridged Tech is paused. The archive is available through June 2, 2026.'

export function clampNewsletterDate(dateStr: string): string {
  return dateStr > NEWSLETTER_LAST_DATE ? NEWSLETTER_LAST_DATE : dateStr
}

export function isAfterNewsletterLastDate(dateStr: string): boolean {
  return dateStr > NEWSLETTER_LAST_DATE
}
