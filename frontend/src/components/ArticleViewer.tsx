import type { Article } from '../api/articles'

export function ArticleViewer({ article }: { article: Article }) {
  return (
    <div style={{
      maxWidth: '700px',
      padding: '24px',
      backgroundColor: 'var(--bg-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-subtle)',
      lineHeight: '1.8',
      fontSize: '15px',
      color: 'var(--text-primary)',
    }}>
      {article.title && (
        <h2 style={{ fontSize: '22px', marginBottom: '8px', lineHeight: '1.3', fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          {article.title}
        </h2>
      )}

      <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '20px' }}>
        {article.author && <span>By {article.author}</span>}
        {article.publication && <span>{article.publication}</span>}
        <a href={article.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
          Original
        </a>
        {article.archive_url && (
          <a href={article.archive_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
            Archive
          </a>
        )}
      </div>

      {article.summary && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: 'var(--accent-muted)',
          borderRadius: 'var(--radius-sm)',
          borderLeft: '3px solid var(--accent)',
          marginBottom: '20px',
          fontSize: '14px',
        }}>
          <strong style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
            AI Summary
          </strong>
          {article.summary}
        </div>
      )}

      {article.full_text && (
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {article.full_text.split('\n').map((paragraph, i) => (
            paragraph.trim() ? (
              <p key={i} style={{ marginBottom: '12px' }}>{paragraph}</p>
            ) : null
          ))}
        </div>
      )}

      {!article.full_text && (
        <p style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          Article content not available.
          <a href={article.archive_url || article.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', marginLeft: '4px' }}>
            View on web
          </a>
        </p>
      )}
    </div>
  )
}
