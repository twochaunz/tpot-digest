import { TweetCard } from './TweetCard'
import type { Tweet } from '../api/tweets'

export function DragOverlayCard({ tweet }: { tweet: Tweet }) {
  return (
    <TweetCard
      tweet={tweet}
      selectable={false}
      overlay
      width={280}
    />
  )
}
