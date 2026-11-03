import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Where the site is served from. Vercel (https://personalwebsitev1-orpin.vercel.app) and the dev
// server serve it at the domain's root; the GitHub Pages workflow builds it for the project path
// /personalwebsite_v1/ by setting BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
