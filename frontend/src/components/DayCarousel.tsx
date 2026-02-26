import { useRef, useEffect, useCallback, useState } from 'react'
import { DayFeedPanel } from './DayFeedPanel'
import type { Tweet } from '../api/tweets'

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

interface DayCarouselProps {
  date: string
  onDateChange: (date: string) => void
  search: string
  genPanelOpen: boolean
  onGenPanelClose: () => void
  initialTopicNum?: number | null
}

export function DayCarousel({ date, onDateChange, search, genPanelOpen, onGenPanelClose, initialTopicNum }: DayCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isScrollingRef = useRef(false)

  // Shared drag state across panels
  const [activeDragTweet, setActiveDragTweet] = useState<Tweet | null>(null)

  // Generate 5 days: current -2 to +2
  const days = Array.from({ length: 5 }, (_, i) => shiftDate(date, i - 2))

  // Panel width/scale/opacity config
  const panelConfig = [
    { widthPct: 20, scale: 0.82, opacity: 0.3 },
    { widthPct: 20, scale: 0.88, opacity: 0.5 },
    { widthPct: 60, scale: 1, opacity: 1 },
    { widthPct: 20, scale: 0.88, opacity: 0.5 },
    { widthPct: 20, scale: 0.82, opacity: 0.3 },
  ]

  // Scroll to center panel
  const scrollToCenter = useCallback((behavior: ScrollBehavior = 'instant') => {
    const container = scrollRef.current
    if (!container) return
    const panels = container.children
    if (panels.length < 5) return

    // Calculate offset to center the middle panel (index 2)
    // We need to scroll so that the center of panel[2] aligns with the center of the container
    let offset = 0
    for (let i = 0; i < 2; i++) {
      offset += (panels[i] as HTMLElement).offsetWidth
    }
    const centerPanel = panels[2] as HTMLElement
    const centerOffset = offset + centerPanel.offsetWidth / 2 - container.clientWidth / 2

    isScrollingRef.current = true
    container.scrollTo({ left: centerOffset, behavior })
    // Clear scrolling flag after animation
    setTimeout(() => {
      isScrollingRef.current = false
    }, behavior === 'instant' ? 50 : 500)
  }, [])

  // On mount and date change, scroll to center
  useEffect(() => {
    scrollToCenter('instant')
  }, [date, scrollToCenter])

  // On scroll settle, detect which panel is centered
  const handleScroll = useCallback(() => {
    if (isScrollingRef.current) return

    clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      const container = scrollRef.current
      if (!container) return

      const containerCenter = container.scrollLeft + container.clientWidth / 2
      const panels = container.children
      let accum = 0

      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i] as HTMLElement
        const panelCenter = accum + panel.offsetWidth / 2
        const distance = Math.abs(containerCenter - panelCenter)

        if (distance < panel.offsetWidth / 2) {
          // This panel is centered
          if (i !== 2) {
            // Not the center panel -- shift date
            const offset = i - 2
            const newDate = shiftDate(date, offset)
            onDateChange(newDate)
          }
          break
        }
        accum += panel.offsetWidth
      }
    }, 150)
  }, [date, onDateChange])

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'ArrowLeft' || e.key === 'h') {
        e.preventDefault()
        onDateChange(shiftDate(date, -1))
      } else if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault()
        onDateChange(shiftDate(date, 1))
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [date, onDateChange])

  return (
    <div
      ref={scrollRef}
      className="day-carousel"
      onScroll={handleScroll}
      style={{
        display: 'flex',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        flex: 1,
        minHeight: 0,
        scrollbarWidth: 'none',
      }}
    >
      {days.map((dayDate, i) => {
        const config = panelConfig[i]
        const isCenter = i === 2
        const isAdjacent = i === 1 || i === 3

        return (
          <div
            key={dayDate}
            style={{
              flex: `0 0 ${config.widthPct}%`,
              scrollSnapAlign: 'center',
              transform: `scale(${config.scale})`,
              opacity: config.opacity,
              transition: 'transform 0.3s ease, opacity 0.3s ease',
              transformOrigin: isCenter ? 'center top' : 'center center',
              position: 'relative',
              height: '100%',
              display: isCenter ? undefined : 'flex',
              alignItems: isCenter ? undefined : 'center',
            }}
          >
            {/* Click overlay for side panels */}
            {!isCenter && (
              <div
                onClick={() => onDateChange(dayDate)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 3,
                  cursor: 'pointer',
                }}
              />
            )}

            <div style={{ pointerEvents: isCenter ? 'auto' : 'none', height: '100%' }}>
              {(isCenter || isAdjacent) ? (
                <DayFeedPanel
                  date={dayDate}
                  search={isCenter ? search : ''}
                  isActive={isCenter}
                  activeDragTweet={isCenter ? activeDragTweet : null}
                  setActiveDragTweet={setActiveDragTweet}
                  genPanelOpen={isCenter ? genPanelOpen : false}
                  onGenPanelClose={onGenPanelClose}
                  initialTopicNum={isCenter ? initialTopicNum : undefined}
                />
              ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{dayDate}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
