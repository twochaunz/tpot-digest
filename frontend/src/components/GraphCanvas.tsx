import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GraphNode, GraphEdge } from '../api/graph'

const STATUS_COLORS: Record<string, string> = {
  emerging: '#4ECDC4',
  trending: '#E8A838',
  peaked: '#E85D3A',
  fading: '#6B6560',
}

interface NodePosition {
  x: number
  y: number
  vx: number
  vy: number
}

interface TooltipState {
  x: number
  y: number
  content: string
}

interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str
}

export function GraphCanvas({ nodes, edges }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const positionsRef = useRef<NodePosition[]>([])
  const navigate = useNavigate()
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  // Compute force-directed layout once when nodes/edges change
  useEffect(() => {
    if (nodes.length === 0) return

    const width = containerRef.current?.clientWidth || 800
    const height = 600

    setCanvasSize({ width, height })

    // Initialize positions randomly
    const positions: NodePosition[] = nodes.map(() => ({
      x: Math.random() * (width - 40) + 20,
      y: Math.random() * (height - 40) + 20,
      vx: 0,
      vy: 0,
    }))

    const nodeIdToIndex = new Map(nodes.map((n, i) => [n.id, i]))

    // Run 100 iterations of spring layout
    const REPULSION = 3000
    const ATTRACTION = 0.02
    const DAMPING = 0.85
    const CENTER_GRAVITY = 0.01

    for (let iter = 0; iter < 100; iter++) {
      // Reset forces
      for (const pos of positions) {
        pos.vx = 0
        pos.vy = 0
      }

      // Repulsion between all pairs
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dx = positions[j].x - positions[i].x
          const dy = positions[j].y - positions[i].y
          const distSq = Math.max(dx * dx + dy * dy, 1)
          const dist = Math.sqrt(distSq)
          const force = REPULSION / distSq
          const fx = (force * dx) / dist
          const fy = (force * dy) / dist
          positions[i].vx -= fx
          positions[i].vy -= fy
          positions[j].vx += fx
          positions[j].vy += fy
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const si = nodeIdToIndex.get(edge.source_topic_id)
        const ti = nodeIdToIndex.get(edge.target_topic_id)
        if (si === undefined || ti === undefined) continue
        const dx = positions[ti].x - positions[si].x
        const dy = positions[ti].y - positions[si].y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = ATTRACTION * dist * (edge.strength || 0.5)
        const fx = force * (dx / dist)
        const fy = force * (dy / dist)
        positions[si].vx += fx
        positions[si].vy += fy
        positions[ti].vx -= fx
        positions[ti].vy -= fy
      }

      // Center gravity
      const cx = width / 2
      const cy = height / 2
      for (const pos of positions) {
        pos.vx += (cx - pos.x) * CENTER_GRAVITY
        pos.vy += (cy - pos.y) * CENTER_GRAVITY
      }

      // Update positions with damping
      for (const pos of positions) {
        pos.x += pos.vx * DAMPING
        pos.y += pos.vy * DAMPING
        // Clamp to canvas bounds
        const r = 12
        pos.x = Math.max(r, Math.min(width - r, pos.x))
        pos.y = Math.max(r, Math.min(height - r, pos.y))
      }
    }

    positionsRef.current = positions

    // Draw to canvas
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = width
    canvas.height = height

    ctx.clearRect(0, 0, width, height)

    // Draw edges
    const nodeIdToPos = new Map(nodes.map((n, i) => [n.id, positions[i]]))
    for (const edge of edges) {
      const sp = nodeIdToPos.get(edge.source_topic_id)
      const tp = nodeIdToPos.get(edge.target_topic_id)
      if (!sp || !tp) continue
      const opacity = (edge.strength || 0.5) * 0.8
      ctx.beginPath()
      ctx.moveTo(sp.x, sp.y)
      ctx.lineTo(tp.x, tp.y)
      ctx.strokeStyle = `rgba(153, 153, 153, ${opacity})`
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Draw nodes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const pos = positions[i]
      const isLarge = node.lifecycle_status === 'trending' || node.lifecycle_status === 'peaked'
      const radius = isLarge ? 12 : 8
      const color = STATUS_COLORS[node.lifecycle_status] || STATUS_COLORS.fading

      // Node circle
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = '#1E1D1B'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Label
      ctx.font = "10px 'Outfit', system-ui, sans-serif"
      ctx.fillStyle = '#9B9590'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(truncate(node.title, 20), pos.x, pos.y + radius + 3)
    }
  }, [nodes, edges])

  const getHoveredNode = useCallback(
    (mx: number, my: number): GraphNode | null => {
      const positions = positionsRef.current
      for (let i = 0; i < nodes.length; i++) {
        const pos = positions[i]
        if (!pos) continue
        const node = nodes[i]
        const isLarge = node.lifecycle_status === 'trending' || node.lifecycle_status === 'peaked'
        const radius = isLarge ? 12 : 8
        const dx = mx - pos.x
        const dy = my - pos.y
        if (dx * dx + dy * dy <= radius * radius) {
          return node
        }
      }
      return null
    },
    [nodes]
  )

  const getHoveredEdge = useCallback(
    (mx: number, my: number): GraphEdge | null => {
      const positions = positionsRef.current
      const nodeIdToPos = new Map(nodes.map((n, i) => [n.id, positions[i]]))
      for (const edge of edges) {
        const sp = nodeIdToPos.get(edge.source_topic_id)
        const tp = nodeIdToPos.get(edge.target_topic_id)
        if (!sp || !tp) continue
        // Point-to-segment distance
        const dx = tp.x - sp.x
        const dy = tp.y - sp.y
        const lenSq = dx * dx + dy * dy
        if (lenSq === 0) continue
        const t = Math.max(0, Math.min(1, ((mx - sp.x) * dx + (my - sp.y) * dy) / lenSq))
        const px = sp.x + t * dx
        const py = sp.y + t * dy
        const distSq = (mx - px) * (mx - px) + (my - py) * (my - py)
        if (distSq <= 25) {
          return edge
        }
      }
      return null
    },
    [nodes, edges]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      const node = getHoveredNode(mx, my)
      if (node) {
        const lines = [
          node.title,
          `Date: ${node.date}`,
          node.sentiment ? `Sentiment: ${node.sentiment}` : null,
          node.summary ? `Summary: ${truncate(node.summary, 80)}` : null,
        ]
          .filter(Boolean)
          .join('\n')
        setTooltip({ x: e.clientX, y: e.clientY, content: lines })
        return
      }

      const edge = getHoveredEdge(mx, my)
      if (edge) {
        setTooltip({
          x: e.clientX,
          y: e.clientY,
          content: `Relationship: ${edge.relationship_type}\nStrength: ${edge.strength.toFixed(2)}`,
        })
        return
      }

      setTooltip(null)
    },
    [getHoveredNode, getHoveredEdge]
  )

  const handleMouseLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const node = getHoveredNode(mx, my)
      if (node) {
        navigate(`/topic/${node.id}`)
      }
    },
    [getHoveredNode, navigate]
  )

  if (nodes.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '600px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-raised)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-tertiary)',
          fontSize: '14px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        No graph data available. Try adjusting filters.
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '600px' }}>
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        style={{
          width: '100%',
          height: '600px',
          display: 'block',
          background: 'var(--bg-raised)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          cursor: 'pointer',
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            maxWidth: '280px',
            whiteSpace: 'pre-wrap',
            pointerEvents: 'none',
            zIndex: 1000,
            lineHeight: '1.5',
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  )
}
