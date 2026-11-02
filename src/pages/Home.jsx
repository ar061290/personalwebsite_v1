import { useRef } from 'react'
import FluidBackground from '../components/Fluid/FluidBackground.jsx'
import MelonCanvas from '../components/Melon/MelonCanvas.jsx'
import useStickers from '../components/Stickers/useStickers.js'
import ScrollHint from '../components/ScrollHint/ScrollHint.jsx'
import JuiceDrop from '../components/JuiceDrop/JuiceDrop.jsx'
import aadiPhoto from '../assets/photos/aadi.webp'
import './Home.css'

export default function Home({ introDone }) {
  const underRef = useRef(null)
  const overRef = useRef(null)
  const impactRef = useRef(null)
  useStickers({ underRef, overRef, enabled: introDone })

  // Layer order lives in global.css (--z-*): paper → stain → page → stickers ↓
  // → fluid → stickers ↑ → drop → melon.
  return (
    <main className="home">
      {/* Fluid and stickers belong to the hero only: they end where it ends. */}
      <section className="hero">
        <div className="sticker-layer sticker-layer--under" ref={underRef} aria-hidden="true" />
        <FluidBackground className="fluid-layer" active={introDone} />
        <div className="sticker-layer sticker-layer--over" ref={overRef} aria-hidden="true" />
        <MelonCanvas className="hero__melon" />
        <ScrollHint visible={introDone} />
      </section>

      <section className="about">
        <figure className="about__photo">
          <span className="about__tape about__tape--left" aria-hidden="true" />
          <span className="about__tape about__tape--right" aria-hidden="true" />
          <img src={aadiPhoto} alt="Aadi Ramnani" width="760" height="950" />
        </figure>
        <div className="about__content" />
        <div className="about__impact" ref={impactRef} data-juice-impact aria-hidden="true" />
      </section>

      <JuiceDrop impactRef={impactRef} active={introDone} />
    </main>
  )
}
