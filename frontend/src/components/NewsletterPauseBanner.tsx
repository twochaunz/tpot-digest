import { NEWSLETTER_PAUSE_MESSAGE } from '../constants/newsletterPause'

const repeats = Array.from({ length: 6 }, (_, i) => i)

export function NewsletterPauseBanner() {
  return (
    <div className="newsletter-pause-banner" role="status" aria-label={NEWSLETTER_PAUSE_MESSAGE}>
      <div className="newsletter-pause-track">
        {repeats.map((i) => (
          <span key={i} className="newsletter-pause-item">
            {NEWSLETTER_PAUSE_MESSAGE}
          </span>
        ))}
      </div>
    </div>
  )
}
