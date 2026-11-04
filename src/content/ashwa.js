// Source: public/Aadi_Ramnani_Resume.pdf (Ashwa Racing; Premier Aerodynamics certification).
export default {
  slug: 'ashwa',
  number: '04',
  title: 'ashwa racing',
  kicker: 'STEM Racing / F1 in Schools',
  lede: 'Chief aerodynamicist and design engineer of Ashwa Racing’s CO2-powered car, since September 2025.',
  stats: [
    { value: '6', label: 'full prototype cycles' },
    { value: '50+', label: 'component iterations' },
    { value: '3+', label: 'CFD solvers' },
    { value: '2nd', label: 'runner-up, South India Regionals (100+ teams)' },
    { value: '6th', label: 'at Nationals' },
  ],
  sections: [
    {
      heading: 'the car',
      entries: [
        {
          title: 'Chief Aerodynamicist & Design Engineer',
          org: 'Ashwa Racing · STEM Racing / F1 in Schools, CO2-powered vehicle',
          when: 'Sept 2025 – present',
          points: [
            'Solo-designed the team’s car across 6 full prototype cycles and 50+ component iterations, grounding each in aerodynamic theory and validating it through CFD in 3+ solvers: the design that reached Nationals.',
            'Placed 2nd runner-up among 100+ teams at the South India Regionals (the team’s highest-ever placement) and 6th at Nationals.',
          ],
        },
      ],
    },
    {
      heading: 'the physics',
      entries: [
        {
          title: 'Traction, nosecones and ideas that didn’t make the car',
          points: [
            'Used first-principles force, energy and momentum analysis to show that wheel traction raises rolling losses rather than forward force, correcting a core team misconception.',
            'Compared nosecone geometries in CFD (elliptical, ogive, von Kármán / Haack) and rejected intuitive-but-inefficient concepts: rifling, the Magnus effect, excess downforce.',
          ],
        },
        {
          title: 'F1 in Schools',
          org: 'Premier Aerodynamics',
          when: '2025',
          note: 'Certification.',
        },
      ],
    },
  ],
}
