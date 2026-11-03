import { useEffect, useRef, useState } from 'react'
import { setMelon } from '../../lib/melonBus.js'
import { useTheme } from '../../lib/theme.js'
import { createMelonEngine } from './engine.js'
import MelonFallback from './MelonFallback.jsx'
import './Melon.css'

const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator
// dev only: /?melon=svg shows the static fallback
const forceFallback = () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('melon') === 'svg'

// The WebGPU hero model: the jelly watermelon in the light theme, the milk-chocolate bar in the
// dark one (the engine swaps them itself on a theme change, at once inside the theme's view
// transition). Covers its parent (via className); transparent everywhere except the model.
// Without WebGPU it renders a static picture of the theme's model instead.
export default function MelonCanvas({ className = '' }) {
  const theme = useTheme()
  const canvasRef = useRef(null)
  const [fallback, setFallback] = useState(() => !hasWebGPU() || forceFallback())

  useEffect(() => {
    if (fallback) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ac = new AbortController()
    let engine = null
    const toFallback = () => {
      if (!ac.signal.aborted) setFallback(true)
    }

    createMelonEngine(canvas, { signal: ac.signal, onFail: toFallback })
      .then((e) => {
        // StrictMode / fast unmount: the engine resolved after cleanup
        if (ac.signal.aborted) {
          e.destroy()
          return
        }
        engine = e
        setMelon(e)
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || ac.signal.aborted) return
        console.warn('[melon] showing the static slice:', err?.message || err)
        toFallback()
      })

    return () => {
      ac.abort()
      if (engine) {
        engine.destroy()
        engine = null
        setMelon(null)
      }
    }
  }, [fallback])

  if (fallback) return <MelonFallback className={className} theme={theme} />

  return (
    <canvas
      ref={canvasRef}
      className={`${className} melon-canvas`.trim()}
      role="img"
      aria-label={
        theme === 'dark'
          ? 'A milk-chocolate bar with a milky filling. Grab it and pull to stretch it.'
          : 'A slice of watermelon jelly. Grab it and pull to stretch it.'
      }
    />
  )
}
