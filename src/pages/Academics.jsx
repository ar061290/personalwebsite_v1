import ContentPage from '../components/Sections/ContentPage.jsx'
import FiveStarMedal from '../components/Sections/FiveStarMedal.jsx'
import page from '../content/academics.js'

export default function Academics() {
  return (
    <>
      <ContentPage page={page} />
      <FiveStarMedal />
    </>
  )
}
