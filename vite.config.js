import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from GitHub Pages at https://ar061290.github.io/personalwebsite_v1/ (a project site, so
// everything lives under the repository's name). The dev server uses the same base.
export default defineConfig({
  base: '/personalwebsite_v1/',
  plugins: [react()],
})
