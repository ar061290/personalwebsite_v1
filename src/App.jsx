import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Intro from './components/Intro/Intro.jsx'
import Cursor from './components/Cursor/Cursor.jsx'
import Header from './components/Header/Header.jsx'
import { scrollToSection } from './components/Header/sectionScroll.js'
import GooglyEyes from './components/Eyes/GooglyEyes.jsx'
import Footer from './components/Footer/Footer.jsx'
import SignWall from './components/SignWall/SignWall.jsx'
import PageStickers from './components/Stickers/PageStickers.jsx'
import Home from './pages/Home.jsx'
import About from './pages/About.jsx'
import Academics from './pages/Academics.jsx'
import Research from './pages/Research.jsx'
import Projects from './pages/Projects.jsx'
import Ashwa from './pages/Ashwa.jsx'
import Drama from './pages/Drama.jsx'
import Leadership from './pages/Leadership.jsx'

/**
 * After each navigation: a new page opens at its top, or at its #section (about, contact).
 * On the same page a #section is scrolled to smoothly; after a route change it is jumped
 * to. On a hard load the intro holds the page still, so a #section waits for it.
 */
function useScrollOnNavigate(introDone) {
  const { pathname, hash, key } = useLocation()
  const lastPath = useRef(null)
  const handled = useRef(null)
  const deferred = useRef(false)

  useEffect(() => {
    const id = hash.replace(/^#/, '')
    const routeChanged = lastPath.current !== pathname
    if (handled.current === key) return
    if (id && !introDone) {
      // the intro holds the page still: go there once it lifts (this effect re-runs then)
      deferred.current = true
      return
    }
    handled.current = key
    lastPath.current = pathname
    const afterIntro = deferred.current
    deferred.current = false

    if (!id) {
      if (routeChanged) window.scrollTo(0, 0)
      return
    }
    if (routeChanged && !afterIntro) window.scrollTo(0, 0)
    // the new page may take a frame to lay out its section
    let tries = 0
    let raf = 0
    const go = () => {
      if (scrollToSection(id, { smooth: !routeChanged || afterIntro })) return
      if (++tries < 30) raf = requestAnimationFrame(go)
    }
    raf = requestAnimationFrame(go)
    return () => cancelAnimationFrame(raf)
  }, [pathname, hash, key, introDone])
}

export default function App() {
  // The intro lives above the router, so it plays once per hard load
  // (first visit or reload on any route) and never on in-app navigation.
  const [introDone, setIntroDone] = useState(false)
  useScrollOnNavigate(introDone)

  return (
    <>
      {!introDone && <Intro onComplete={() => setIntroDone(true)} />}
      <Cursor />
      <Header />
      <GooglyEyes />
      <Routes>
        <Route path="/" element={<Home introDone={introDone} />} />
        <Route path="/about" element={<About />} />
        <Route path="/academics" element={<Academics />} />
        <Route path="/research" element={<Research />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/ashwa" element={<Ashwa />} />
        <Route path="/drama" element={<Drama />} />
        <Route path="/leadership" element={<Leadership />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
      <SignWall />
      <PageStickers enabled={introDone} />
    </>
  )
}
