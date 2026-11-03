import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/global.css'
import './styles/paper.css'

// Every hard load plays the intro, so always open at the top of the page.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
window.scrollTo(0, 0)

createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
    <App />
  </BrowserRouter>,
)
