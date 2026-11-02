import { Link } from 'react-router-dom'
import './Header.css'

export default function Header() {
  return (
    <header className="site-header">
      <Link className="site-header__name" to="/">aadi ramnani</Link>
      <div className="site-header__eyes-slot" data-eyes-slot="header" aria-hidden="true" />
      <nav className="site-header__nav">
        <Link to="/about">about</Link>
      </nav>
    </header>
  )
}
