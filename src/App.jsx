import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Intro from './components/Intro/Intro.jsx'
import Cursor from './components/Cursor/Cursor.jsx'
import Header from './components/Header/Header.jsx'
import GooglyEyes from './components/Eyes/GooglyEyes.jsx'
import Home from './pages/Home.jsx'
import About from './pages/About.jsx'

export default function App() {
  // The intro lives above the router, so it plays once per hard load
  // (first visit or reload on any route) and never on in-app navigation.
  const [introDone, setIntroDone] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <>
      {!introDone && <Intro onComplete={() => setIntroDone(true)} />}
      <Cursor />
      <Header />
      <GooglyEyes />
      <Routes>
        <Route path="/" element={<Home introDone={introDone} />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
