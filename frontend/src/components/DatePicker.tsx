import { useState, useCallback, useRef, useEffect } from 'react'

interface DatePickerProps {
  value: string // YYYY-MM-DD
  onChange: (date: string) => void
  maxDate?: string // YYYY-MM-DD — dates after this are disabled
  compact?: boolean
}

function formatDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCompact(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${m}/${d}/${y}`
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

const arrowBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontSize: 16,
  transition: 'all 0.15s ease',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function DatePicker({ value, onChange, maxDate, compact }: DatePickerProps) {
  const [hovered, setHovered] = useState<'prev' | 'next' | null>(null)
  const [dateHovered, setDateHovered] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => parseInt(value.split('-')[0]))
  const [viewMonth, setViewMonth] = useState(() => parseInt(value.split('-')[1]) - 1)
  const [hoveredDay, setHoveredDay] = useState<number | null>(null)
  const [calMonthHovered, setCalMonthHovered] = useState<'prev' | 'next' | null>(null)
  const calRef = useRef<HTMLDivElement>(null)

  const goPrev = useCallback(() => onChange(shiftDate(value, -1)), [value, onChange])
  const isAtMax = !!(maxDate && value >= maxDate)
  const goNext = useCallback(() => {
    if (isAtMax) return
    onChange(shiftDate(value, 1))
  }, [value, onChange, isAtMax])

  // Reset viewYear/viewMonth when calendar opens
  useEffect(() => {
    if (calendarOpen) {
      setViewYear(parseInt(value.split('-')[0]))
      setViewMonth(parseInt(value.split('-')[1]) - 1)
    }
  }, [calendarOpen, value])

  // Close on outside click
  useEffect(() => {
    if (!calendarOpen) return
    function handleClick(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setCalendarOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [calendarOpen])

  const toggleCalendar = useCallback(() => {
    setCalendarOpen((prev) => !prev)
  }, [])

  const goCalPrevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1)
        return 11
      }
      return m - 1
    })
  }, [])

  const goCalNextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1)
        return 0
      }
      return m + 1
    })
  }, [])

  const selectDay = useCallback(
    (day: number) => {
      const mm = String(viewMonth + 1).padStart(2, '0')
      const dd = String(day).padStart(2, '0')
      onChange(`${viewYear}-${mm}-${dd}`)
      setCalendarOpen(false)
    },
    [viewYear, viewMonth, onChange],
  )

  // Parse selected date
  const [selYear, selMonth, selDay] = value.split('-').map(Number)

  // Today
  const now = new Date()
  const todayYear = now.getFullYear()
  const todayMonth = now.getMonth()
  const todayDay = now.getDate()

  // Calendar grid data
  const totalDays = daysInMonth(viewYear, viewMonth)
  const startDay = firstDayOfWeek(viewYear, viewMonth)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onClick={goPrev}
        onMouseEnter={() => setHovered('prev')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...arrowBtn,
          borderColor: hovered === 'prev' ? 'var(--border-strong)' : 'var(--border)',
          color: hovered === 'prev' ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
        aria-label="Previous day"
      >
        &#8249;
      </button>

      <div ref={calRef} style={{ position: 'relative' }}>
        <span
          onClick={toggleCalendar}
          onMouseEnter={() => setDateHovered(true)}
          onMouseLeave={() => setDateHovered(false)}
          style={{
            fontSize: compact ? 16 : 18,
            fontWeight: 600,
            color: 'var(--text-primary)',
            minWidth: compact ? 90 : 160,
            textAlign: 'center',
            letterSpacing: '-0.01em',
            cursor: 'pointer',
            display: 'inline-block',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            background: dateHovered ? 'var(--bg-hover)' : 'transparent',
            transition: 'background 0.15s ease',
            userSelect: 'none',
          }}
        >
          {compact ? formatCompact(value) : formatDisplay(value)}
        </span>

        {calendarOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginTop: 8,
              background: 'var(--bg-raised)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow)',
              padding: 16,
              zIndex: 50,
              minWidth: 280,
            }}
          >
            {/* Calendar header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <button
                onClick={goCalPrevMonth}
                onMouseEnter={() => setCalMonthHovered('prev')}
                onMouseLeave={() => setCalMonthHovered(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: calMonthHovered === 'prev' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 18,
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'color 0.15s ease',
                }}
                aria-label="Previous month"
              >
                &#8249;
              </button>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  userSelect: 'none',
                }}
              >
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
              <button
                onClick={goCalNextMonth}
                onMouseEnter={() => setCalMonthHovered('next')}
                onMouseLeave={() => setCalMonthHovered(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: calMonthHovered === 'next' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 18,
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'color 0.15s ease',
                }}
                aria-label="Next month"
              >
                &#8250;
              </button>
            </div>

            {/* Day-of-week headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 0,
                marginBottom: 4,
              }}
            >
              {DAY_HEADERS.map((d) => (
                <div
                  key={d}
                  style={{
                    textAlign: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    padding: '4px 0',
                    userSelect: 'none',
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 0,
              }}
            >
              {/* Empty cells for days before the 1st */}
              {Array.from({ length: startDay }).map((_, i) => (
                <div key={`empty-${i}`} style={{ width: 36, height: 36 }} />
              ))}
              {/* Day number cells */}
              {Array.from({ length: totalDays }).map((_, i) => {
                const day = i + 1
                const isSelected =
                  viewYear === selYear && viewMonth === selMonth - 1 && day === selDay
                const isToday =
                  viewYear === todayYear && viewMonth === todayMonth && day === todayDay
                const isHovered = hoveredDay === day
                const dayStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const isFuture = !!(maxDate && dayStr > maxDate)

                let bg = 'transparent'
                let color = isFuture ? 'var(--text-tertiary)' : 'var(--text-primary)'
                if (isSelected) {
                  bg = 'var(--accent)'
                  color = '#fff'
                } else if (isHovered && !isFuture) {
                  bg = 'var(--bg-hover)'
                } else if (isToday) {
                  bg = 'var(--bg-elevated)'
                }

                return (
                  <div
                    key={day}
                    onClick={() => !isFuture && selectDay(day)}
                    onMouseEnter={() => !isFuture && setHoveredDay(day)}
                    onMouseLeave={() => setHoveredDay(null)}
                    style={{
                      width: 36,
                      height: 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      fontSize: 13,
                      fontWeight: isSelected || isToday ? 600 : 400,
                      color,
                      background: bg,
                      cursor: isFuture ? 'not-allowed' : 'pointer',
                      opacity: isFuture ? 0.4 : 1,
                      transition: 'all 0.1s ease',
                      userSelect: 'none',
                    }}
                  >
                    {day}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={goNext}
        onMouseEnter={() => setHovered('next')}
        onMouseLeave={() => setHovered(null)}
        disabled={isAtMax}
        style={{
          ...arrowBtn,
          borderColor: isAtMax ? 'var(--border)' : hovered === 'next' ? 'var(--border-strong)' : 'var(--border)',
          color: isAtMax ? 'var(--text-tertiary)' : hovered === 'next' ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: isAtMax ? 'not-allowed' : 'pointer',
          opacity: isAtMax ? 0.4 : 1,
        }}
        aria-label="Next day"
      >
        &#8250;
      </button>
    </div>
  )
}
