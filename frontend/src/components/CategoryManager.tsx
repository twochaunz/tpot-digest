import { useState } from 'react'
import { useCategories, useCreateCategory, useDeleteCategory } from '../api/categories'
import type { Category } from '../api/categories'

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f59e0b', // amber
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
]

function CategoryRow({
  category,
  onDelete,
  deleting,
}: {
  category: Category
  onDelete: (id: number) => void
  deleting: boolean
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: hovered ? 'var(--bg-hover)' : 'transparent',
        borderRadius: 'var(--radius-md)',
        transition: 'background 0.1s ease',
      }}
    >
      {/* Color dot */}
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: category.color || 'var(--text-tertiary)',
          flexShrink: 0,
        }}
      />

      {/* Name */}
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--text-primary)',
        }}
      >
        {category.name}
      </span>

      {/* Delete button */}
      <button
        onClick={() => onDelete(category.id)}
        disabled={deleting}
        style={{
          background: 'none',
          border: 'none',
          color: hovered ? 'var(--error)' : 'transparent',
          fontSize: 16,
          cursor: deleting ? 'not-allowed' : 'pointer',
          padding: '2px 6px',
          borderRadius: 'var(--radius-sm)',
          transition: 'color 0.15s ease',
          fontFamily: 'var(--font-body)',
          opacity: deleting ? 0.5 : 1,
        }}
        aria-label={`Delete ${category.name}`}
      >
        &#10005;
      </button>
    </div>
  )
}

export function CategoryManager() {
  const { data: categories, isLoading } = useCategories()
  const createMutation = useCreateCategory()
  const deleteMutation = useDeleteCategory()

  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [showForm, setShowForm] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    createMutation.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          setName('')
          setColor(PRESET_COLORS[0])
          setShowForm(false)
        },
      },
    )
  }

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id)
  }

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Discourse Categories
          </h3>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              margin: '4px 0 0',
            }}
          >
            Organize tweets within topics by discourse type
          </p>
        </div>

        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: '#fff',
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              fontFamily: 'var(--font-body)',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'var(--accent-hover)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'var(--accent)')
            }
          >
            + Add Category
          </button>
        )}
      </div>

      {/* Category list */}
      <div style={{ padding: '8px 6px' }}>
        {isLoading && (
          <div
            style={{
              padding: '20px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-tertiary)',
            }}
          >
            Loading categories...
          </div>
        )}

        {!isLoading && categories && categories.length === 0 && !showForm && (
          <div
            style={{
              padding: '24px 20px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-tertiary)',
            }}
          >
            No categories yet. Add one to organize tweets by discourse type.
          </div>
        )}

        {categories?.map((cat) => (
          <CategoryRow
            key={cat.id}
            category={cat}
            onDelete={handleDelete}
            deleting={deleteMutation.isPending}
          />
        ))}
      </div>

      {/* Inline create form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            padding: '12px 20px 16px',
            borderTop: '1px solid var(--border)',
          }}
        >
          {/* Name input */}
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}
            >
              Category name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Analysis, Hype, Criticism"
              autoFocus
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
                fontFamily: 'var(--font-body)',
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = 'var(--accent)')
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = 'var(--border-strong)')
              }
            />
          </div>

          {/* Color picker */}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}
            >
              Color
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: c,
                    border:
                      color === c
                        ? '2px solid var(--text-primary)'
                        : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'border-color 0.15s ease',
                  }}
                  aria-label={`Select color ${c}`}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={!name.trim() || createMutation.isPending}
              style={{
                background:
                  !name.trim() || createMutation.isPending
                    ? 'var(--bg-elevated)'
                    : 'var(--accent)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color:
                  !name.trim() || createMutation.isPending
                    ? 'var(--text-tertiary)'
                    : '#fff',
                padding: '7px 16px',
                fontSize: 12,
                fontWeight: 500,
                cursor:
                  !name.trim() || createMutation.isPending
                    ? 'not-allowed'
                    : 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.15s ease',
              }}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setName('')
                setColor(PRESET_COLORS[0])
              }}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                padding: '7px 14px',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
