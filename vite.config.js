import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  // server 區塊僅影響 vite dev（本機測試），不影響 build 產出
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://vendor-shift-platform-l5ro2vr7fq-de.a.run.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
