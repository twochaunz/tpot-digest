import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DatePicker } from '../components/DatePicker'
import { DayCarousel } from '../components/DayCarousel'
import { TableOfContents } from '../components/TableOfContents'
import { useAuth } from '../contexts/AuthContext'

function todayDateStr(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function defaultDateStr(): string {
  // Use PST (UTC-8) to determine time of day
  const now = new Date()
  const pstHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getHours()
  // Before noon PST, default to yesterday
  const d = pstHour < 12 ? new Date(now.getTime() - 86400000) : now
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function parseDateParam(dateStr?: string): string | null {
  if (!dateStr || dateStr.length !== 8) return null
  const yyyy = dateStr.slice(0, 4)
  const mm = dateStr.slice(4, 6)
  const dd = dateStr.slice(6, 8)
  const parsed = `${yyyy}-${mm}-${dd}`
  // Validate it's a real date
  const d = new Date(parsed)
  if (isNaN(d.getTime())) return null
  return parsed
}

function toDateParam(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

export function DailyView() {
  const navigate = useNavigate()
  const { dateStr: urlDateStr, topicNum: urlTopicNum } = useParams<{ dateStr?: string; topicNum?: string }>()
  const { isAdmin } = useAuth()

  const initialDate = parseDateParam(urlDateStr) || defaultDateStr()
  const [date, setDateRaw] = useState(initialDate)
  const today = todayDateStr()
  const pendingTopicNum = useRef<number | null>(urlTopicNum ? parseInt(urlTopicNum, 10) : null)

  const setDate = useCallback((d: string) => {
    if (d > today) return
    setDateRaw(d)
    pendingTopicNum.current = null
    navigate(`/app/${toDateParam(d)}`, { replace: true })
  }, [today, navigate])
  // Sync URL on initial load if no date param was provided
  useEffect(() => {
    if (!urlDateStr) {
      navigate(`/app/${toDateParam(date)}`, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [genPanelOpen, setGenPanelOpen] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'

      if ((e.key === 't' || e.key === 'T') && !isInput) {
        e.preventDefault()
        setTocOpen(prev => !prev)
      }
      if (e.key === '?' && !isInput) {
        e.preventDefault()
        setKeysOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur()
      }

      // Up/Down: navigate between category sections
      // Return/Shift+Return: navigate between topic sections
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'j' || e.key === 'Enter') && !isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const feedPanel = document.querySelector<HTMLElement>('[data-active-feed="true"]')
        if (!feedPanel) return

        const isTopicNav = e.key === 'Enter'
        const selector = isTopicNav ? '[id^="toc-topic-"]' : '[id^="toc-cat-"]'
        const elements = Array.from(feedPanel.querySelectorAll<HTMLElement>(selector))
        if (elements.length === 0) return

        const goBack = isTopicNav ? e.shiftKey : (e.key === 'ArrowUp' || e.key === 'k')
        const panelTop = feedPanel.getBoundingClientRect().top

        // For category nav inside a topic, account for sticky topic header
        const getStickyOffset = (el: HTMLElement) => {
          if (isTopicNav) return 0
          const parentTopic = el.closest<HTMLElement>('[id^="toc-topic-"]')
          if (!parentTopic) return 0
          const header = parentTopic.querySelector<HTMLElement>(':scope > div')
          return header ? header.offsetHeight : 0
        }

        // The "visible top" for category elements is below the sticky header
        const getVisibleTop = (el: HTMLElement) =>
          el.getBoundingClientRect().top - panelTop - getStickyOffset(el)

        // Find which element is closest to the visible top (the "current" one)
        let currentIdx = 0
        let minDist = Infinity
        for (let i = 0; i < elements.length; i++) {
          const dist = Math.abs(getVisibleTop(elements[i]))
          if (dist < minDist) {
            minDist = dist
            currentIdx = i
          }
        }

        const targetIdx = goBack ? currentIdx - 1 : currentIdx + 1
        // If current element isn't snapped to visible top yet, navigating forward should go to it first
        if (!goBack && getVisibleTop(elements[currentIdx]) > 30) {
          e.preventDefault()
          const offset = getStickyOffset(elements[currentIdx])
          feedPanel.scrollTo({ top: feedPanel.scrollTop + elements[currentIdx].getBoundingClientRect().top - panelTop - offset, behavior: 'smooth' })
          return
        }
        if (targetIdx < 0 || targetIdx >= elements.length) return

        e.preventDefault()
        const target = elements[targetIdx]
        const offset = getStickyOffset(target)
        feedPanel.scrollTo({ top: feedPanel.scrollTop + target.getBoundingClientRect().top - panelTop - offset, behavior: 'smooth' })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div
      style={{
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column' as const,
      }}
    >
      {/* Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* Left: keyboard shortcuts + generate scripts */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setKeysOpen(true)}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 16,
                transition: 'all 0.15s ease',
              }}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              ?
            </button>
            {isAdmin && <button
              onClick={() => setGenPanelOpen(true)}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 16,
                transition: 'all 0.15s ease',
              }}
              aria-label="Generate scripts"
              title="Generate scripts"
            >
              &#9998;
            </button>}
          </div>

          {/* Center: date picker */}
          <DatePicker value={date} onChange={setDate} maxDate={today} />

          {/* Right: search + settings */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search tweets"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  width: searchFocused || search ? 240 : 180,
                  background: 'var(--bg-raised)',
                  border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '7px 12px 7px 32px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  fontFamily: 'var(--font-body)',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                  fontSize: 14,
                  pointerEvents: 'none',
                }}
              >
                &#8981;
              </span>
              {/* Cmd+K hint badge */}
              {!searchFocused && !search && (
                <span
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-tertiary)',
                    fontSize: 10,
                    fontFamily: 'var(--font-body)',
                    background: 'var(--bg-elevated)',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    pointerEvents: 'none',
                    border: '1px solid var(--border)',
                  }}
                >
                  &#8984;K
                </span>
              )}
            </div>

            {isAdmin && <button
              onClick={() => navigate('/app/settings')}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 16,
                transition: 'all 0.15s ease',
              }}
              aria-label="Settings"
            >
              &#9881;
            </button>}
          </div>
        </div>
      </header>

      {/* Day carousel */}
      <DayCarousel
        date={date}
        onDateChange={setDate}
        search={debouncedSearch}
        genPanelOpen={genPanelOpen}
        onGenPanelClose={() => setGenPanelOpen(false)}
        initialTopicNum={pendingTopicNum.current}
      />

      {/* TOC FAB button */}
      {!tocOpen && (
        <button
          onClick={() => setTocOpen(true)}
          aria-label="Table of Contents"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 20,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 50,
            transition: 'all 0.15s ease',
          }}
        >
          &#9776;
        </button>
      )}

      {/* TOC overlay */}
      {tocOpen && (
        <TableOfContents
          date={date}
          search={debouncedSearch}
          onClose={() => setTocOpen(false)}
        />
      )}

      {/* Keyboard shortcuts modal */}
      {keysOpen && (
        <KeyboardShortcutsModal onClose={() => setKeysOpen(false)} />
      )}

    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['h / \u2190', 'Previous date'],
  ['l / \u2192', 'Next date'],
  ['j / \u2193', 'Next category section'],
  ['k / \u2191', 'Previous category section'],
  ['Enter', 'Next topic'],
  ['Shift + Enter', 'Previous topic'],
  ['t', 'Toggle table of contents'],
  ['\u2318K', 'Focus search'],
  ['Esc', 'Blur search / close overlay'],
  ['?', 'Toggle this help'],
]

function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          minWidth: 300,
          maxWidth: 400,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{desc}</span>
              <kbd style={{
                fontSize: 11,
                fontFamily: 'var(--font-body)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                color: 'var(--text-primary)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
