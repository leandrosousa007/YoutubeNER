import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const proxy = { '/api': process.env.YOUTUBENER_API_URL ?? 'http://127.0.0.1:8000' }

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
