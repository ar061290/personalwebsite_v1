// The scroll-scrubbed juice drop (milk in dark mode) that falls from the
// hero's tip and soaks into the paper at the about section's impact marker.
// All the work lives in juiceController.js; this only mounts its two layers:
//   .juice-stain  the stain, IN the paper (z --z-stain, blended with it)
//   .juice-drop   the drop sprite (z --z-drop)
import { useEffect, useRef } from 'react'
import { createJuice } from './juiceController.js'
import './JuiceDrop.css'

export default function JuiceDrop({ impactRef, active = true }) {
  const dropRef = useRef(null)
  const stainRef = useRef(null)
  const apiRef = useRef(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    let api = null
    try {
      api = createJuice({
        dropCanvas: dropRef.current,
        stainHost: stainRef.current,
        getImpactEl: () => impactRef?.current ?? document.querySelector('[data-juice-impact]'),
      })
      api.setActive(activeRef.current)
    } catch (err) {
      console.warn('[juice] init failed:', err)
      api = null
    }
    apiRef.current = api
    return () => {
      apiRef.current = null
      try {
        api?.destroy()
      } catch {
        // never throw into React
      }
    }
  }, [impactRef])

  useEffect(() => {
    apiRef.current?.setActive(active)
  }, [active])

  return (
    <>
      <div className="juice-stain" ref={stainRef} aria-hidden="true" />
      <canvas className="juice-drop" ref={dropRef} aria-hidden="true" />
    </>
  )
}
