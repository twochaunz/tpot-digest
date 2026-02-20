import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from './components/Sidebar'
import { TodaysFeed } from './pages/TodaysFeed'
import { TopicDetail } from './pages/TopicDetail'
import { GraphExplorer } from './pages/GraphExplorer'
import { AssetManager } from './pages/AssetManager'
import { Settings } from './pages/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30000, // Auto-refresh every 30s
      staleTime: 10000,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar />
          <main style={{ flex: 1, padding: '24px', overflow: 'auto' }}>
            <Routes>
              <Route path="/" element={<TodaysFeed />} />
              <Route path="/topic/:topicId" element={<TopicDetail />} />
              <Route path="/graph" element={<GraphExplorer />} />
              <Route path="/assets" element={<AssetManager />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
