// Source: public/Aadi_Ramnani_Resume.pdf (experience, research & projects, awards).
export default {
  slug: 'projects',
  number: '03',
  title: 'projects & side quests',
  lede: 'A peer-tutoring startup, a virtual chemistry lab, a street-food safety study and a water rocket, six prototypes deep.',
  sections: [
    {
      heading: 'projects',
      entries: [
        {
          title: 'TutorLink',
          org: 'Co-founder & product lead · peer-to-peer academic platform (ed-tech startup)',
          when: '6-month development cycle',
          links: [{ label: 'tutorlink.world', href: 'https://tutorlink.world' }],
          points: [
            'Co-founded a peer-tutoring platform with transparent, blockchain-logged contribution tracking (Polygon).',
            'Ran two-stage market research with 125+ respondents (81% stated adoption); ML tutor–learner matching at 0.86 F1.',
            'Pitched to industry judges: runner-up at a competitive venture showcase.',
          ],
        },
        {
          title: 'Chemistar',
          org: 'AI-powered virtual chemistry laboratory',
          tags: ['TypeScript', 'NLP', 'Simulation'],
          points: [
            'An AI-driven web platform for free-form virtual experiments with unsafe, rare or cost-prohibitive reactions (250+ reaction types); an NLP parser turns natural-language experiment designs into runs at 0.82 F1, and a dynamic engine models temperature and pH in real time without pre-scripted reactions.',
            '1st place at C-HACKS; presented to 150+ attendees including Microsoft leadership.',
            'Coaches IGCSE Chemistry and built resources used by 3 teachers.',
          ],
        },
      ],
    },
    {
      heading: 'side quests',
      entries: [
        {
          title: 'Air & water rocket',
          org: 'Iterative prototyping',
          points: [
            'Built 6 prototypes and 12 launch-pad architectures through failure-driven iteration; tuned the air-to-water ratio to 1:3 and the pressure thresholds.',
            'Integrated altimeter, pressure and GPS sensors to validate flights against simulations, and converged on a carbon-fibre final configuration.',
          ],
        },
        {
          title: 'Hackathons',
          note: 'IIT Jodhpur: Flying Wings · Mission Brain',
        },
      ],
    },
  ],
}
