import axios from 'axios'

// In production (behind Caddy), use relative URL /api
// In development, use localhost:8000/api
const baseURL = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({
  baseURL,
  timeout: 30000,
})
