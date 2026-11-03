// Source: public/Aadi_Ramnani_Resume.pdf (education, awards & certifications).
import cambridgeCrest from '../assets/academics/cambridge-crest.svg'
import ibLogo from '../assets/academics/ib-logo.svg'
import award1 from '../assets/academics/awards/award-1.webp'
import award2 from '../assets/academics/awards/award-2.webp'
import award3 from '../assets/academics/awards/award-3.webp'
import award4 from '../assets/academics/awards/award-4.webp'

// Certificates live in one Drive folder per item (Aadi_Ramnani_9to12_Certificates)
const drive = (id) => `https://drive.google.com/drive/folders/${id}`

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
      heading: 'awards',
      // Outstanding Cambridge Learner Awards, 2025: the medal, then on stage
      slides: [{ src: award1 }, { src: award2 }, { src: award3 }, { src: award4 }],
      slidesLabel: 'Receiving the Outstanding Cambridge Learner Award, Top in the World for Chemistry',
      entries: [
        {
          title: 'Outstanding Cambridge Learner Award, Top in the World (Chemistry)',
          org: 'Cambridge Assessment International Education',
          when: '2025',
          view: drive('1ZD8eMqxVBC_FS2w_7TXYYYFChqJ8zvev'),
        },
        {
          title: 'IGCSE Physics (0625) School/Grade Topper',
          org: 'Cambridge Assessment International Education (CAIE)',
          when: '2025',
        },
        {
          title: 'Distinction in the Cambridge International Certificate of Education (ICE)',
          org: 'Cambridge Assessment International Education',
          when: '2025',
        },
        {
          title: 'Bronze Award',
          org: 'Singapore and Asian Schools Math Olympiad (SASMO)',
          when: '2025',
          view: drive('1YgisH9vcMISaztv-kfYu4_xXXCcaN4wS'),
        },
        {
          title: 'First Place, Outstanding Exploration and Integration of a Significant Global Scientific Issue',
          org: 'IBDP Collaborative Science Project',
          when: '2026',
          view: drive('1ZurwY_YKEToRxK-LnsjE77KpYTnsqfRB'),
        },
        {
          title: 'Venture and Tech Summer Program (VTSP)',
          when: '2026',
        },
        {
          title: 'Summer Science Program (SSP)',
          when: '2026',
        },
      ],
    },
    {
      heading: 'certifications',
      list: [
        { title: 'Data Science & AI', org: 'IIT Madras', when: '2026', view: drive('1apkRurMOjefdG6gd-_BdNzgQNXXB7qey') },
        { title: 'Quantum Computing', org: 'IIT Hyderabad', when: '2025', view: drive('1wlAzTNDPAhBs1M1rUukQ38yCbJ3i_V4B') },
        { title: 'Software Development', org: 'IIT Hyderabad', when: '2025', view: drive('18EbeL_iCiHz2r0hO1V9BRuvnmKfbP1ms') },
        { title: 'Premier Aerodynamics', org: 'F1 in Schools', when: '2025' },
        { title: 'Software Engineering · Intro to AI · Generative AI · Prompt Engineering · HTML/CSS/JS', org: 'IBM / Coursera', when: '2025', view: drive('1u0-C-5vtiqnDVVR8alVzEc3taQxHF1m8') },
        { title: 'Industry & Innovation', org: 'T-HUB', when: '2024', view: drive('1tTd1efzG4mJlx-Pk-newZ8ojc-2SP5jV') },
        { title: 'Technology & Sustainability', org: 'Infosys', when: '2023', view: drive('1xoygF82hrqNRhnimi95MyJg19jwK1gbG') },
      ],
    },
  ],
}
