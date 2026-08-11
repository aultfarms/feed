import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/treatments/',
  plugins: [react()],
  server: {
    open: true,
    port: 8080,
  },
})
