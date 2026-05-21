import { Component, type ReactNode } from 'react'
import { Tweet as ReactTweet } from 'react-tweet'

interface SafeReactTweetProps {
  id: string
  apiUrl?: string
}

interface SafeReactTweetState {
  failed: boolean
}

export class SafeReactTweet extends Component<SafeReactTweetProps, SafeReactTweetState> {
  state: SafeReactTweetState = { failed: false }

  static getDerivedStateFromError(): SafeReactTweetState {
    return { failed: true }
  }

  componentDidUpdate(prevProps: SafeReactTweetProps): void {
    if (this.state.failed && (prevProps.id !== this.props.id || prevProps.apiUrl !== this.props.apiUrl)) {
      this.setState({ failed: false })
    }
  }

  render(): ReactNode {
    const { id, apiUrl } = this.props

    if (this.state.failed) {
      return (
        <a
          href={`https://x.com/i/status/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'block',
            padding: '12px 14px',
            color: 'var(--accent)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          Open quoted post on X
        </a>
      )
    }

    return <ReactTweet id={id} apiUrl={apiUrl} />
  }
}
