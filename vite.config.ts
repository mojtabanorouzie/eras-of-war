import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * `base` must match where the site is served from.
 *
 *  - dev / `vite preview`      -> "/"
 *  - GitHub Pages project site -> "/<repository-name>/"
 *
 * The deploy workflow sets VITE_BASE_PATH from the repository name, so the
 * build works for any repo name without editing this file.
 */
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH ?? (command === 'build' ? './' : '/'),
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 700,
  },
}))
