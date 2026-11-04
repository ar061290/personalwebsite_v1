// Source: public/Aadi_Ramnani_Resume.pdf (education, awards & certifications).
import cambridgeCrest from '../assets/academics/cambridge-crest.svg'
import ibLogo from '../assets/academics/ib-logo.svg'
import award1 from '../assets/academics/awards/award-1.webp'
import award2 from '../assets/academics/awards/award-2.webp'
import award3 from '../assets/academics/awards/award-3.webp'
import award4 from '../assets/academics/awards/award-4.webp'
// the certifications' providers, die-cut (white paper or black made see-through, a white vinyl edge
// round each shape), largest first
import iitmLogo from '../assets/academics/iitm.webp'
import iithLogo from '../assets/academics/iith.webp'
import ibmLogo from '../assets/academics/ibm.webp'
import infosysLogo from '../assets/academics/infosys.webp'
import thubLogo from '../assets/academics/thub.webp'
import premierLogo from '../assets/academics/premier.webp'

// The certificates, the site's own copies (WebP renders of the originals in the
// Aadi_Ramnani_9to12_Certificates Drive folders, src/assets/certificates):
// `view` lists the ones behind an entry, and its "view" button opens them over the page (CertViewer).
const CERTS = import.meta.glob('../assets/certificates/*.webp', { eager: true, import: 'default' })
const certs = (...names) =>
  names.map((n) => {
    const src = CERTS[`../assets/certificates/${n}.webp`]
    if (!src) throw new Error(`academics: no certificate "${n}"`)
    return src
  })
// one document over several pages (the viewer counts them as pages)
const pages = (...names) => Object.assign(certs(...names), { pages: true })

export default {
  slug: 'academics',
  number: '01',
  title: 'awards, honors & academics',
  lede: 'Second year of the IB Diploma at CHIREC International School, Hyderabad, after a Cambridge IGCSE with 8 A*s.',
  stats: [
    { value: '7', label: 'predicted in 5 IB subjects' },
    { value: '1540', label: 'SAT (math 790, EBRW 750)' },
    { value: '100', label: 'IGCSE chemistry, world topper' },
  ],
  sections: [
    {
      heading: 'education',
      stickers: [
        { src: cambridgeCrest, alt: 'University of Cambridge crest', tilt: -7 },
        { src: ibLogo, alt: 'International Baccalaureate logo', tilt: 8 },
      ],
      entries: [
        {
          title: 'IB Diploma Programme, year 2',
          org: 'CHIREC International School',
          place: 'Hyderabad, India',
          when: 'Aug 2025 – May 2027',
          note: 'Predicted 7 in 5 subjects, 6 in English.',
          grades: [
            { k: 'Physics HL', v: '7' },
            { k: 'Chemistry HL', v: '7' },
            { k: 'Mathematics AA HL', v: '7' },
            { k: 'Business SL', v: '7' },
            { k: 'English SL', v: '6' },
            { k: 'French SL', v: '7' },
          ],
        },
        {
          title: 'Cambridge IGCSE',
          org: 'CHIREC International School',
          when: 'Completed May 2025',
          note: '8 A*s, 1 A · average PUM 94 · ICE with Distinction · World Topper in Chemistry.',
          grades: [
            { k: 'Chemistry', v: '100' },
            { k: 'Biology', v: '97' },
            { k: 'Mathematics', v: '97' },
            { k: 'Physics', v: '96' },
            { k: 'Computer Science', v: '95' },
            { k: 'Additional Mathematics', v: '95' },
            { k: 'Economics', v: '94' },
            { k: 'French', v: '90' },
            { k: 'English', v: '84' },
          ],
        },
        {
          title: 'SAT',
          when: 'June 2025',
          note: '1540: Math 790, Evidence-Based Reading & Writing 750.',
        },
      ],
    },
    {
      heading: 'awards & honors',
      // Outstanding Cambridge Learner Awards, 2025: the medal, then on stage
      slides: [{ src: award1 }, { src: award2 }, { src: award3 }, { src: award4 }],
      slidesLabel: 'Receiving the Outstanding Cambridge Learner Award, Top in the World for Chemistry',
      entries: [
        {
          title: 'Outstanding Cambridge Learner Award, Top in the World (Chemistry)',
          org: 'Cambridge Assessment International Education',
          when: '2025',
          view: certs('chemistry-award'),
        },
        {
          title: 'IGCSE Physics (0625) School/Grade Topper',
          org: 'Cambridge Assessment International Education (CAIE)',
          when: '2025',
          view: certs('physics-topper'),
        },
        {
          title: 'Distinction in the Cambridge International Certificate of Education (ICE)',
          org: 'Cambridge Assessment International Education',
          when: '2025',
          view: certs('ice'),
        },
        {
          title: 'Bronze Award',
          org: 'Singapore and Asian Schools Math Olympiad (SASMO)',
          when: '2025',
          view: certs('sasmo'),
        },
        {
          title: 'First Place, Outstanding Exploration and Integration of a Significant Global Scientific Issue',
          org: 'IBDP Collaborative Science Project',
          orgTo: '/research#csp',
          when: '2026',
          view: certs('csp'),
        },
        {
          title: 'Venture and Tech Summer Program (VTSP)',
          when: '2026',
          view: pages('vtsp-1', 'vtsp-2'),
        },
        {
          title: 'Summer Science Program (SSP)',
          when: '2026',
          view: certs('ssp'),
        },
      ],
    },
    {
      heading: 'certifications',
      stickersWrap: true,
      stickers: [
        { src: iitmLogo, alt: 'IIT Madras seal', tilt: -6, width: 'clamp(96px, 9.5vw, 140px)' },
        { src: iithLogo, alt: 'IIT Hyderabad logo', tilt: 5, width: 'clamp(90px, 9vw, 132px)' },
        { src: ibmLogo, alt: 'IBM logo', tilt: 4, width: 'clamp(110px, 11vw, 160px)' },
        { src: infosysLogo, alt: 'Infosys logo', tilt: -5, width: 'clamp(82px, 8vw, 116px)' },
        { src: thubLogo, alt: 'T-Hub logo', tilt: 7, width: 'clamp(62px, 6vw, 88px)' },
        { src: premierLogo, alt: 'Premier Aerodynamics logo', tilt: -4, width: 'clamp(96px, 9.2vw, 136px)' },
      ],
      list: [
        { title: 'Data Science & AI', org: 'IIT Madras', when: '2026', view: certs('iitm-1', 'iitm-2') },
        { title: 'Quantum Computing', org: 'IIT Hyderabad', when: '2025', view: certs('iith-quantum') },
        { title: 'Software Development', org: 'IIT Hyderabad', when: '2025', view: certs('iith-software') },
        { title: 'F1 in Schools', org: 'Premier Aerodynamics', when: '2025' },
        { title: 'Software Engineering · Intro to AI · Generative AI · Prompt Engineering · HTML/CSS/JS', org: 'IBM', when: '2025', view: certs('ibm-1', 'ibm-2', 'ibm-3', 'ibm-4', 'ibm-5') },
        { title: 'Industry & Innovation', org: 'T-HUB', when: '2024', view: certs('thub') },
        { title: 'Technology & Sustainability', org: 'Infosys', when: '2023', view: certs('infosys') },
      ],
    },
  ],
}
