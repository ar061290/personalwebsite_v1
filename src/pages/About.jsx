import { Link } from 'react-router-dom'

export default function About() {
  return (
    <main className="page page--placeholder">
      <p className="page__kicker">about</p>
      <h1 className="page__title">coming soon.</h1>
      <Link className="page__back" to="/">back to the melon</Link>
    </main>
  )
}
