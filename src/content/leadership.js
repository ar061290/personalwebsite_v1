// Source: public/Aadi_Ramnani_Resume.pdf (leadership & activities).
export default {
  slug: 'leadership',
  number: '06',
  title: 'leadership & volunteering',
  lede: 'Safeguarding, teaching CAD, cutting waste, learning sign language and running a theatre collective, alongside school.',
  stats: [
    { value: '97', label: 'student ambassadors coordinated' },
    { value: '~1,000', label: 'students reached by 20 workshops' },
    { value: '~40%', label: 'food-waste reduction in week one' },
  ],
  sections: [
    {
      heading: 'leadership',
      entries: [
        {
          title: 'Cyberbullying Lead',
          org: 'School-wide safeguarding initiative',
          when: '12+ months',
          points: [
            'Coordinated 97 student ambassadors and 11 faculty mentors; designed and delivered 20 workshops reaching ~1,000 students.',
            'Realigned 6 institutional policies to the Diana Award Anti-Bullying Ambassador framework.',
            'Launched a weekly advocacy newsletter and parent sessions.',
          ],
        },
        {
          title: 'Co-Founder & Instructor, 3D Printing Club',
          org: 'CHIREC International School',
          when: 'Grade 8 (2022–2023)',
          points: [
            'The youngest student to launch an after-school technical club at CHIREC; taught CAD (Fusion 360, Cura) and additive manufacturing.',
            'Members later independently built the first physical prototype.',
          ],
        },
        {
          title: 'President & Co-Founder, The Drama Collective',
          org: '50+ members across ~10 departments',
          when: 'Ongoing',
          links: [{ label: 'more on the drama page', to: '/drama' }],
        },
      ],
    },
    {
      heading: 'volunteering',
      entries: [
        {
          title: 'Litter League',
          org: 'School waste-management club',
          points: [
            'Designed waste-segregation workflows and ran segregation at major school events (including CHIREC MUN), achieving a ~40% food-waste reduction in week one.',
          ],
        },
        {
          title: 'Zero-Waste Outreach',
          org: 'Independent',
          points: [
            'Designed and delivered 4 awareness sessions on zero-waste living and recycling to 500+ students (grades 2–8) and a local orphanage.',
            'Joined lake clean-ups across Hyderabad.',
          ],
        },
        {
          title: 'Project SignVerse',
          points: ['Completed months of sign-language training; 1 of ~7 students chosen for the Sign-A-Thon accessibility walk.'],
        },
        {
          title: 'Interact Club',
          when: '3 years',
          points: ['Fundraising and outreach for children living with HIV/AIDS.'],
        },
      ],
    },
  ],
}
