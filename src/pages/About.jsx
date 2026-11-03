import { Navigate } from 'react-router-dom'

// "about" is the part of the home page below the melon (section#about).
export default function About() {
  return <Navigate to={{ pathname: '/', hash: '#about' }} replace />
}
