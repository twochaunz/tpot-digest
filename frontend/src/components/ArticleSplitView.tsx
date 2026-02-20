import { ArticleViewer } from './ArticleViewer'
import { TweetCard } from './TweetCard'
import type { Article } from '../api/articles'
import type { Tweet } from '../api/tweets'

interface Props {
  tweet: Tweet
  article: Article
  onClose: () => void
}

export function ArticleSplitView({ tweet, article, onClose }: Props) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'stretch',
      padding: '40px',
    }}>
      <div style={{
        display: 'flex',
        gap: '20px',
        maxWidth: '1400px',
        width: '100%',
        backgroundColor: '#f5f5f5',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        {/* Left: Tweet */}
        <div style={{
          width: '400px',
          padding: '24px',
          overflowY: 'auto',
          backgroundColor: '#fafafa',
          borderRight: '1px solid #e0e0e0',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', margin: 0 }}>Source Tweet</h3>
            <button
              onClick={onClose}
              style={{
                border: 'none',
                background: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#666',
              }}
            >
              x
            </button>
          </div>
          <TweetCard tweet={tweet} />
        </div>

        {/* Right: Article */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          <ArticleViewer article={article} />
        </div>
      </div>
    </div>
  )
}
