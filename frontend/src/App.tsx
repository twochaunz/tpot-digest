import './styles/design-system.css'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { DailyView } from './pages/DailyView'
import { SettingsPage } from './pages/SettingsPage'
import { DigestComposer } from './pages/DigestComposer'
import { SendLogPage } from './pages/SendLogPage'
import { DigestSignupPopup } from './components/DigestSignupPopup'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="/app" element={<DailyView />} />
            <Route path="/app/:dateStr" element={<DailyView />} />
            <Route path="/app/:dateStr/:topicNum" element={<DailyView />} />
            <Route path="/app/settings" element={<SettingsPage />} />
            <Route path="/app/digest" element={<DigestComposer />} />
            <Route path="/app/send-log" element={<SendLogPage />} />
          </Routes>
          <DigestSignupPopup />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
