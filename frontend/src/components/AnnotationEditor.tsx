import { useState, useRef, useCallback, useEffect } from 'react'
import { Stage, Layer, Image, Rect, Line } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type Konva from 'konva'
import { Toolbar, type ToolType } from './tools/Toolbar'
import { useAnnotationHistory, type Annotation } from '../hooks/useAnnotationHistory'

interface Props {
  imageUrl: string
  onSave?: (annotations: Annotation[], dataUrl: string) => void
  onClose?: () => void
}

export function AnnotationEditor({ imageUrl, onSave, onClose }: Props) {
  const stageRef = useRef<Konva.Stage>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [activeTool, setActiveTool] = useState<ToolType>('highlight')
  const [color, setColor] = useState('#FFEB3B')
  const [opacity, setOpacity] = useState(0.4)
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentPoints, setCurrentPoints] = useState<number[]>([])
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)

  const { annotations, addAnnotation, undo, redo, clear, canUndo, canRedo } = useAnnotationHistory()

  // Load the image
  useEffect(() => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setImage(img)
    img.src = imageUrl
  }, [imageUrl])

  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return

    setIsDrawing(true)

    if (activeTool === 'freehand') {
      setCurrentPoints([pos.x, pos.y])
    } else {
      setDrawStart(pos)
    }
  }, [activeTool])

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (!isDrawing) return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return

    if (activeTool === 'freehand') {
      setCurrentPoints(prev => [...prev, pos.x, pos.y])
    }
  }, [isDrawing, activeTool])

  const handleMouseUp = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (!isDrawing) return
    setIsDrawing(false)
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    if (activeTool === 'freehand' && currentPoints.length >= 4) {
      addAnnotation({
        id,
        type: 'freehand',
        color,
        opacity: 1,
        points: [...currentPoints, pos.x, pos.y],
      })
      setCurrentPoints([])
    } else if ((activeTool === 'highlight' || activeTool === 'box') && drawStart) {
      const width = pos.x - drawStart.x
      const height = pos.y - drawStart.y
      if (Math.abs(width) > 5 && Math.abs(height) > 5) {
        addAnnotation({
          id,
          type: activeTool,
          color,
          opacity: activeTool === 'highlight' ? opacity : 1,
          x: Math.min(drawStart.x, pos.x),
          y: Math.min(drawStart.y, pos.y),
          width: Math.abs(width),
          height: Math.abs(height),
        })
      }
      setDrawStart(null)
    }
  }, [isDrawing, activeTool, currentPoints, drawStart, color, opacity, addAnnotation])

  const handleExport = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const dataUrl = stage.toDataURL({ pixelRatio: 2 })
    if (onSave) {
      onSave(annotations, dataUrl)
    } else {
      // Download directly
      const link = document.createElement('a')
      link.download = 'annotated.png'
      link.href = dataUrl
      link.click()
    }
  }, [annotations, onSave])

  if (!image) return <p>Loading image...</p>

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px', backgroundColor: '#fff' }}>
        <Toolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          color={color}
          onColorChange={setColor}
          opacity={opacity}
          onOpacityChange={setOpacity}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onClear={clear}
          onExport={handleExport}
        />
        {onClose && (
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '24px', cursor: 'pointer', padding: '8px', color: '#666' }}>
            x
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
        <Stage
          ref={stageRef}
          width={image.width}
          height={image.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: activeTool === 'select' ? 'default' : 'crosshair' }}
        >
          <Layer>
            <Image image={image} />
          </Layer>
          <Layer>
            {annotations.map(a => {
              if (a.type === 'highlight') {
                return (
                  <Rect
                    key={a.id}
                    x={a.x}
                    y={a.y}
                    width={a.width}
                    height={a.height}
                    fill={a.color}
                    opacity={a.opacity}
                  />
                )
              }
              if (a.type === 'box') {
                return (
                  <Rect
                    key={a.id}
                    x={a.x}
                    y={a.y}
                    width={a.width}
                    height={a.height}
                    stroke={a.color}
                    strokeWidth={3}
                  />
                )
              }
              if (a.type === 'freehand' && a.points) {
                return (
                  <Line
                    key={a.id}
                    points={a.points}
                    stroke={a.color}
                    strokeWidth={3}
                    tension={0.5}
                    lineCap="round"
                    lineJoin="round"
                  />
                )
              }
              return null
            })}
            {/* Drawing in progress */}
            {isDrawing && activeTool === 'freehand' && currentPoints.length >= 2 && (
              <Line
                points={currentPoints}
                stroke={color}
                strokeWidth={3}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}
