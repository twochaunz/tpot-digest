import { useRef, useState, useCallback, useEffect } from 'react'

interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

interface CropToolProps {
  imageUrl: string
}

export function CropTool({ imageUrl }: CropToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [displayScale, setDisplayScale] = useState(1)

  // Load image once
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      setImgLoaded(true)
      setCrop(null)
    }
    img.src = imageUrl
  }, [imageUrl])

  // Draw canvas whenever image loads or crop changes
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !imgLoaded) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Scale image to fit within max dimensions
    const maxW = 600
    const maxH = 500
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
    const dispW = Math.round(img.naturalWidth * scale)
    const dispH = Math.round(img.naturalHeight * scale)

    setDisplayScale(scale)
    canvas.width = dispW
    canvas.height = dispH

    // Draw image
    ctx.drawImage(img, 0, 0, dispW, dispH)

    // Draw crop overlay
    if (crop && crop.w > 0 && crop.h > 0) {
      // Darken area outside crop
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'

      // Top
      ctx.fillRect(0, 0, dispW, crop.y)
      // Bottom
      ctx.fillRect(0, crop.y + crop.h, dispW, dispH - crop.y - crop.h)
      // Left
      ctx.fillRect(0, crop.y, crop.x, crop.h)
      // Right
      ctx.fillRect(crop.x + crop.w, crop.y, dispW - crop.x - crop.w, crop.h)

      // Crop border
      ctx.strokeStyle = 'var(--accent, #6366f1)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h)
      ctx.setLineDash([])
    }
  }, [imgLoaded, crop, displayScale])

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    },
    [],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getCanvasCoords(e)
      setStartPoint(coords)
      setDragging(true)
      setCrop(null)
    },
    [getCanvasCoords],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragging || !startPoint) return
      const coords = getCanvasCoords(e)

      const x = Math.min(startPoint.x, coords.x)
      const y = Math.min(startPoint.y, coords.y)
      const w = Math.abs(coords.x - startPoint.x)
      const h = Math.abs(coords.y - startPoint.y)

      setCrop({ x, y, w, h })
    },
    [dragging, startPoint, getCanvasCoords],
  )

  const handleMouseUp = useCallback(() => {
    setDragging(false)
    setStartPoint(null)
  }, [])

  const handleReset = useCallback(() => {
    setCrop(null)
  }, [])

  const handleCropDownload = useCallback(() => {
    const img = imgRef.current
    if (!img || !crop || crop.w < 2 || crop.h < 2) return

    // Convert display coords to native image coords
    const sx = crop.x / displayScale
    const sy = crop.y / displayScale
    const sw = crop.w / displayScale
    const sh = crop.h / displayScale

    // Create offscreen canvas for cropping at native resolution
    const offscreen = document.createElement('canvas')
    offscreen.width = Math.round(sw)
    offscreen.height = Math.round(sh)
    const ctx = offscreen.getContext('2d')
    if (!ctx) return

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, offscreen.width, offscreen.height)

    // Trigger download
    const link = document.createElement('a')
    link.download = `cropped-${Date.now()}.png`
    link.href = offscreen.toDataURL('image/png')
    link.click()
  }, [crop, displayScale])

  if (!imgLoaded) {
    return (
      <div
        style={{
          padding: '24px',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}
      >
        Loading image...
      </div>
    )
  }

  const hasCrop = crop && crop.w > 2 && crop.h > 2

  return (
    <div>
      {/* Canvas */}
      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          cursor: dragging ? 'crosshair' : 'crosshair',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            display: 'block',
            maxWidth: '100%',
          }}
        />
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 12,
          alignItems: 'center',
        }}
      >
        <button
          onClick={handleCropDownload}
          disabled={!hasCrop}
          style={{
            background: hasCrop ? 'var(--accent)' : 'var(--bg-elevated)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: hasCrop ? '#fff' : 'var(--text-tertiary)',
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 500,
            cursor: hasCrop ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-body)',
            transition: 'all 0.15s ease',
          }}
        >
          Crop &amp; Download
        </button>
        <button
          onClick={handleReset}
          disabled={!crop}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            color: crop ? 'var(--text-secondary)' : 'var(--text-tertiary)',
            padding: '7px 14px',
            fontSize: 12,
            cursor: crop ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-body)',
          }}
        >
          Reset
        </button>

        {!hasCrop && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              marginLeft: 4,
            }}
          >
            Click and drag to select a crop area
          </span>
        )}
      </div>
    </div>
  )
}
