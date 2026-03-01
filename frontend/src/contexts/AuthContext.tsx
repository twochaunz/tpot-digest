import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchAuthMe, type Role } from '../api/auth'
import { api } from '../api/client'

interface AuthContextValue {
  role: Role
  isAdmin: boolean
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({
  role: 'viewer',
  isAdmin: false,
  loading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('viewer')
  const [loading, setLoading] = useState(true)
  // Capture search params during render (before child effects can strip them)
  const initialSearch = useRef(window.location.search)

  useEffect(() => {
    async function init() {
      // Check URL for admin key (using captured search params)
      const params = new URLSearchParams(initialSearch.current)
      const adminKey = params.get('admin')
      if (adminKey) {
        try {
          await api.get('/auth/admin', { params: { key: adminKey } })
        } catch {
          // Invalid key — continue as viewer
        }
        // Remove admin param from URL without reload
        params.delete('admin')
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params}`
          : window.location.pathname
        window.history.replaceState({}, '', newUrl)
      }

      // Check current auth status
      try {
        const data = await fetchAuthMe()
        setRole(data.role)
      } catch {
        setRole('viewer')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  return (
    <AuthContext.Provider value={{ role, isAdmin: role === 'admin', loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
