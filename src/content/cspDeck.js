// The CSP presentation (the IBDP Collaborative Sciences Project, Group 20), rebuilt from the team's
// Canva deck as slides the research page's slide viewer (DocViewer.jsx) draws: the same content and
// photos, with the run-together words, overlapping text and overflowing slides of the export fixed.
// A slide is { kind, subject?, title?, ... }:
//   cover    the research question, the group and the vendor illustration
//   section  a subject's title slide: its name and research question
//   text     a title, bullets (a string, or { text, sub: [...] }) and an optional `media` beside them:
//            { img, alt } | { table } (a key of TABLES) | { imgs: [{ img, alt, label }] }
//   gallery  a title and a row of images with labels
//   end      the closing slide
// `subject` picks the accent: physics, ess, chemistry, biology, cs (none: the deck's own).
import vendor from '../assets/csp-deck/vendor.webp'
import map from '../assets/csp-deck/map.webp'
import lab from '../assets/csp-deck/lab.webp'
import coolingGraph from '../assets/csp-deck/cooling-graph.webp'
import beakers from '../assets/csp-deck/beakers.webp'
import phMeter from '../assets/csp-deck/ph-meter.webp'
import incubator from '../assets/csp-deck/incubator.webp'
import heatPh from '../assets/csp-deck/heat-ph.webp'
import heatWaste from '../assets/csp-deck/heat-waste.webp'
import heatTemp from '../assets/csp-deck/heat-temp.webp'
import scatter from '../assets/csp-deck/scatter.webp'
import barsPh from '../assets/csp-deck/bars-ph.webp'
import barsWaste from '../assets/csp-deck/bars-waste.webp'
import appRaw from '../assets/csp-deck/app-raw.webp'
import appDash from '../assets/csp-deck/app-dash.webp'
import appCharts from '../assets/csp-deck/app-charts.webp'
import panipuri from '../assets/csp-deck/panipuri.webp'

const RQ = {
  physics: 'How does container material and insulation affect the rate of heat gain or loss in stored pani puri water?',
  ess: 'How do disposal materials at pani puri stalls in Gachibowli influence daily solid-waste mass and local environmental cleanliness?',
  chemistry:
    'How does short-term exposure affect the pH of pani puri water across different neighbourhoods in Gachibowli, and what does this indicate about microbial contamination and water quality?',
  biology:
    'How do temperature and exposure conditions influence the potential for microbial growth in street-food water, based on measured physical and chemical indicators?',
  cs: 'How can spatial mapping and basic data visualisation reveal patterns in food-safety indicators and waste generation across Hyderabad neighbourhoods?',
}

/** The tables, by key: a caption, the head row and the body rows (`mark`: a row to pick out). */
export const TABLES = {
  stalls: {
    caption: 'Temperature of the pani puri water (PPW) over 5 minutes at each stall',
    head: ['Stall', 'Region', 'Storage', 'Lid', 'Initial (±0.1 °C)', 'Final (±0.1 °C)', 'Change (±0.2 °C)'],
    rows: [
      ['1', 'Telecom Nagar', 'Thick painted ceramic', 'Thin wood', '24.1', '23.8', '−0.3'],
      ['2', 'Telecom Nagar', 'Steel', 'Steel', '24.3', '21.1', '−3.2'],
      ['3', 'Vinayak Nagar', 'Steel', 'Steel (partly covered)', '24.7', '23.8', '−0.9'],
      ['4', 'Vinayak Nagar', 'Steel in wet cotton', 'Steel', '20.5', '23.5', '+3.0'],
      ['5', 'Rajiv Gandhi Nagar', 'Steel', 'Aluminium (partly covered)', '26.5', '26.1', '−0.4'],
      ['6', 'Rajiv Gandhi Nagar', 'Steel', 'Aluminium', '24.5', '23.6', '−0.9'],
    ],
  },
  waste: {
    caption: 'Daily dry waste per stall (masses ±0.01 g)',
    head: ['Stall', 'Bowl', 'g / bowl', 'g / tissue', 'Bowls', 'Tissues', 'Bowl waste (g)', 'Tissue waste (g)', 'Total (g)'],
    rows: [
      ['1', 'Sugarcane', '2.09', '1.06', '200', '280', '418', '296.8', '714.8'],
      ['2', 'Silver laminated', '1.79', '0.83', '100', '750', '179', '622.5', '801.5'],
      ['3', 'Silver laminated', '1.69', '0.75', '200', '100', '338', '75', '413'],
      ['4', 'Silver laminated', '1.76', '0.88', '200', '550', '352', '484', '836'],
      ['5', 'Styrofoam', '0.50', '0.73', '175', '125', '87.5', '91.25', '178.75'],
      ['6', 'Silver laminated', '1.70', '0.69', '100', '200', '170', '138', '308'],
    ],
  },
  ph: {
    caption: 'pH of each sample before and after two hours’ exposure (±0.1)',
    head: ['Sample', 'Location', 'Initial pH', 'Final pH', 'Change'],
    rows: [
      ['1', 'Telecom Nagar', '3.2', '2.5', '−0.7'],
      ['2', 'Telecom Nagar', '2.6', '2.2', '−0.4'],
      ['3', 'Vinayak Nagar', '2.8', '2.1', '−0.7'],
      ['4', 'Vinayak Nagar', '2.7', '2.1', '−0.6'],
      ['5', 'Rajiv Gandhi Nagar', '3.7', '3.3', '−0.4'],
      ['6', 'Rajiv Gandhi Nagar', '2.5', '2.3', '−0.2'],
    ],
  },
}

const table = (key, mark) => ({ table: key, mark })

export const cspDeck = {
  title: 'CSP presentation: pani puri water in Gachibowli',
  slides: [
    {
      kind: 'cover',
      kicker: 'IBDP Collaborative Sciences Project',
      title:
        'How do food handling and short-term storage conditions in different Gachibowli neighbourhoods influence measurable indicators of food safety and environmental waste?',
      people: 'Group 20 · Aadi, Abhinav, Divena, Niveditha, Shaurya',
      mentor: 'Mentor: Ritika Ma’am',
      img: vendor,
      alt: 'Illustration of a pani puri vendor at his cart on a busy market street',
    },
    {
      kind: 'questions',
      title: 'One street food, five subjects',
      items: [
        ['physics', 'Physics', RQ.physics],
        ['ess', 'Environmental systems & societies', RQ.ess],
        ['chemistry', 'Chemistry', RQ.chemistry],
        ['biology', 'Biology', RQ.biology],
        ['cs', 'Computer science', RQ.cs],
      ],
    },
    {
      kind: 'text',
      title: 'Six stalls, three neighbourhoods',
      bullets: [
        'Six pani puri stalls across Telecom Nagar, Vinayak Nagar and Rajiv Gandhi Nagar in Gachibowli, Hyderabad.',
        'At each: the container, its lid, the water’s temperature, a sample for pH, and the day’s disposables.',
        'Framed by SDG 3, good health and well-being: street food is where a lot of the city eats.',
      ],
      media: { img: map, alt: 'Satellite map of Gachibowli with the six stalls pinned', fit: 'cover' },
    },

    { kind: 'section', subject: 'physics', title: 'Physics', rq: RQ.physics },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Primary data',
      bullets: [
        'Measured the temperature change of the pani puri water (PPW) in its container over 5 minutes.',
        {
          text: 'Why only 5 minutes? It keeps out variation from:',
          sub: ['changes in room temperature', 'serving food to the crowd', 'large changes in wind', 'people blocking the airflow'],
        },
      ],
      media: table('stalls'),
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Lids and covering',
      bullets: [
        'Every stall covered its PPW, for safety and against evaporation.',
        'It was covered partially (about 75%) or completely.',
        'Partial or complete covering made no significant difference.',
        'Neither did aluminium against steel lids, possibly because the lid never touches the PPW.',
      ],
      media: table('stalls'),
    },
    {
      kind: 'pair',
      subject: 'physics',
      title: 'Two ways the water loses heat',
      items: [
        ['Conduction', 'through the container’s wall, set by its material, thickness and porosity'],
        ['Evaporative cooling', 'water evaporating from a wet wrap, taking its latent heat from the container'],
      ],
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Conduction: the ceramic pot',
      bullets: [
        {
          text: 'Ceramic was the most insulating material at the stalls (stall 1).',
          sub: ['the same could apply to other street foods', 'possibly the best for hot foods, as it is also heat-proof'],
        },
        {
          text: 'Why ceramic insulates:',
          sub: [
            'it is often very porous: internal air pockets slow heat transfer and delay thermal equilibrium',
            'very strong ionic bonds with high covalent character, and no delocalised electrons',
            'so its particles vibrate with very little amplitude',
          ],
        },
      ],
      media: table('stalls', 0),
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Conduction: testing it in the lab',
      bullets: [
        'To check this, we measured how fast different container materials cool.',
        'Temperature every 30 seconds for 120 seconds.',
        'A constant 80 cm³ of homemade PPW, to remove differences between stalls’ recipes.',
        'Starting at 50 °C, to model conduction clearly.',
      ],
      media: { img: lab, alt: 'Lab photos: four containers of PPW, a water bath, and a thermometer clamped in a container' },
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Conduction: what the lab showed',
      bullets: [
        'The experiment matches the accepted thermal conductivities: steel > thick glass > plastic.',
        'The lab’s ceramic was very thin, dense and not very porous, so it insulated poorly here.',
        'So insulation depends as much, if not more, on thickness and porosity (trapped air) as on the material itself.',
        'Thicker, less dense, more porous is better.',
      ],
      media: {
        img: coolingGraph,
        alt: 'Graph of temperature against time: plastic −0.26 °C/min, thick glass −1.58, steel −2.4, very thin dense ceramic −2.52',
        fit: 'contain',
      },
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Evaporative cooling: the wet cotton wrap',
      bullets: [
        'Ceramic wasn’t the best choice after all: steel wrapped in wet cotton was (stall 4).',
        'Water in the cotton evaporates (below its boiling point), taking heat from the container and so from the PPW.',
        {
          text: 'More heat comes from the container than from the air, because its path is solid to solid:',
          sub: ['container: solid → solid (fabric) → water', 'surroundings: air → solid (fabric) → water'],
        },
        'Latent heat of vaporisation, the energy to turn liquid into gas at the same temperature, is drawn from the PPW. It’s how wet clay pots and desert coolers work.',
      ],
      media: table('stalls', 3),
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Evaporative cooling: why stall 4 warmed up',
      bullets: [
        'In the cloth-wrapped stall the temperature rose, unlike every other stall.',
        'We collected in winter, in the evening: the air was colder than the PPW, so the PPW at every other stall cooled toward it.',
        'All day, evaporation from the wrap had kept stall 4’s PPW cooling, until it sat well below the air.',
        'Once the water in the wrap had evaporated, heat flowed back in from the air and the PPW warmed, as the data shows.',
      ],
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Evaporative cooling: testing it in the lab',
      bullets: [
        'We compared an unwrapped beaker with one wrapped in water-soaked cotton.',
        'Both held 35 mL of homemade PPW at the same start, 17.9 °C, in identical beakers.',
        'Over 15 minutes, the dry beaker warmed more than 140% as much as the wrapped one: evaporation offset part of the heat flowing in.',
        'The PPW still warmed despite the wrap, so an insulator, not a conductor, should carry it.',
      ],
      media: { img: beakers, alt: 'Two beakers of PPW: one bare, one wrapped in wet white cotton' },
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Details and limitations',
      bullets: [
        'The containers’ shapes and construction varied from stall to stall.',
        'The air temperature wasn’t controlled.',
        'Stirring wasn’t standardised: stall 2’s large drop may come from the vendor stirring often, to keep its denser ingredients from settling.',
        'Density differences in the PPW mean different dissolved content, which could shift its heat capacity slightly.',
        'But densities varied very little (1.002 to 1.060 g/cm³), so the big differences in cooling come from the containers and their insulation.',
      ],
    },
    {
      kind: 'text',
      subject: 'physics',
      title: 'Summary',
      bullets: [
        'Vendors cover their pani puri water anyway.',
        {
          text: 'The best container is an insulator: thick, less dense and porous.',
          sub: ['plastic insulates best (ceramic and glass are fragile), but carries health risks'],
        },
        'Evaporative cooling beats insulation alone: a wet fabric wrap offsets a lot of the heat flowing in.',
      ],
    },

    { kind: 'section', subject: 'ess', title: 'Environmental systems & societies', rq: RQ.ess },
    {
      kind: 'text',
      subject: 'ess',
      title: 'What each stall throws away in a day',
      wide: true,
      media: table('waste'),
      foot: 'Bowl waste = bowls used × mass per bowl. Tissue waste = tissues used × mass per tissue.',
    },
    {
      kind: 'columns',
      subject: 'ess',
      title: 'Primary research: the bowls',
      cols: [
        [
          'Sugarcane (stall 1)',
          [
            '714.8 g of dry waste a day',
            'Biodegradable: breaks down within weeks',
            'Its natural fibre soaks up food moisture without releasing harmful chemicals',
            'Costly, and mixed with plastic it decomposes slowly and attracts pests',
          ],
        ],
        [
          'Silver laminated paper (stalls 2, 3, 4, 6)',
          [
            '308–836 g a day',
            'Three layers: paper, aluminium foil, plastic',
            'The foil resists biodegradation and complicates recycling',
            'Food-safe and leak-proof, but dumped in open drains it clogs them',
          ],
        ],
        [
          'Styrofoam (stall 5)',
          [
            '178.75 g a day, as it is very light',
            'Neither biodegradable nor recyclable',
            'Breaks into microplastics that build up in food and water',
            'Releases styrene with hot, oily food: headaches, stomach irritation',
          ],
        ],
      ],
    },
    {
      kind: 'text',
      subject: 'ess',
      title: 'Primary research: to conclude',
      bullets: [
        'Tissues improve hygiene but add to the daily waste (stalls 2 and 6).',
        'Sugarcane bowls are better for the environment, but costly and hard to get.',
        'Silver laminated and thermocol bowls are more common because they’re cheap and convenient.',
        'There is a strong need for policy and community action: subsidise biodegradable alternatives, install waste segregation and run awareness campaigns.',
      ],
    },
    {
      kind: 'columns',
      subject: 'ess',
      title: 'Secondary research: dry against wet',
      cols: [
        [
          'Sugarcane bowls',
          [
            'Dry: compost in 30–90 days',
            'Wet: food soaks the fibre and blocks the air and microbes it needs to rot',
            'Stays soggy 6–12 months, smells, draws flies; only 30–40% breaks down',
          ],
        ],
        [
          'Silver laminated bowls',
          ['Dry: 40–50% can be recycled into paper and foil', 'Wet: the waste glues the foil shut', 'Only 0–10% recyclable after, and it clogs machines'],
        ],
        [
          'Styrofoam',
          ['Dry: 20–25% reusable, melted into bricks', 'Wet: crumbles into tiny bits', 'Spreads as microplastics and releases harmful chemicals'],
        ],
      ],
      foot: 'Vendors want to separate dry and wet waste, but the GHMC (Greater Hyderabad Municipal Corporation) collects everything mixed each morning. The willingness is there; the city’s support isn’t.',
    },
    {
      kind: 'columns',
      subject: 'ess',
      title: 'Sustainable development goals',
      cols: [
        [
          'SDG 11: sustainable cities and communities',
          [
            'Segregating waste at stalls means less litter on the streets',
            'Fewer drains clogged by laminated bowls, so less flooding',
            'Cleaner public spaces around food stalls',
            'Stall 4’s 836 g a day, unsegregated, could clog 1–2 drains a month per neighbourhood',
          ],
        ],
        [
          'SDG 12: responsible consumption and production',
          [
            'Use sugarcane bowls',
            'Cut disposables: tissues more than double the waste (stall 2: 801.5 g against stall 6: 308 g)',
            'Prevent, reuse and recycle',
            'Proper segregation lifts recycling 40–50% and cuts landfill',
          ],
        ],
      ],
    },

    { kind: 'section', subject: 'chemistry', title: 'Chemistry', rq: RQ.chemistry },
    {
      kind: 'text',
      subject: 'chemistry',
      title: 'Aim and method',
      bullets: [
        'Aim: how does short-term open exposure change the pH of prepared pani puri water, and what might that say about its chemical stability and microbial activity?',
        'Samples came from three neighbourhoods: Telecom Nagar, Vinayak Nagar and Rajiv Gandhi Nagar.',
        '30 mL of each went into a 50 mL plastic beaker; the first pH reading was at 9:15 am.',
        'Left open at room temperature for two hours, then read again at 11:15 am.',
        'Every reading was checked on two different pH meters.',
      ],
      media: { img: phMeter, alt: 'A red pH meter standing in a beaker of pani puri water in the lab' },
    },
    {
      kind: 'text',
      subject: 'chemistry',
      title: 'Results',
      bullets: [
        'pH fell in every sample: a consistent downward trend over the exposure.',
        'The drop ranged from 0.2 to 0.7: largest in samples 3 and 4 (Vinayak Nagar), smallest in 5 and 6 (Rajiv Gandhi Nagar).',
      ],
      media: table('ph'),
    },
    {
      kind: 'text',
      subject: 'chemistry',
      title: 'Analysis',
      bullets: [
        'Microbial growth during exposure can cause fermentation and organic acids, lowering the pH.',
        'But contamination wasn’t measured directly, and ingredients and preparation weren’t controlled, so the drop can’t be put down to storage alone.',
        'Carbon dioxide dissolving into carbonic acid, and differences in the ingredients’ buffering, could also explain it.',
      ],
    },

    { kind: 'section', subject: 'biology', title: 'Biology', rq: RQ.biology },
    {
      kind: 'text',
      subject: 'biology',
      title: 'What the readings say about microbes',
      bullets: [
        'The water sat between 20 and 26.5 °C, a range that supports microbial activity (Baranyi & Roberts, 1991).',
        'Over 2 hours its pH fell by 0.2–0.7 (about 0.5 on average), a sign of organic acids from microbial metabolism (Zhang et al., 2024).',
        'Vinayak Nagar’s pH fell 0.35 more than Rajiv Gandhi Nagar’s: older pani, exposed for longer, gives microbes more time to feed and release acids.',
        'Cooling slowed the changes but never took the water out of a growth-supporting range.',
      ],
      media: { img: incubator, alt: 'Covered sample dishes on the racks of a lab incubator' },
    },

    { kind: 'section', subject: 'cs', title: 'Computer science', rq: RQ.cs },
    {
      kind: 'gallery',
      subject: 'cs',
      title: 'Mapping the data',
      imgs: [
        { img: heatPh, alt: 'Heatmap of pH change across the stalls’ locations', label: 'pH heatmap' },
        { img: heatTemp, alt: 'Heatmap of temperature change across the stalls’ locations', label: 'temperature-change heatmap' },
        { img: heatWaste, alt: 'Heatmap of waste mass across the stalls’ locations', label: 'waste-mass heatmap' },
        { img: scatter, alt: 'Scatter plot of temperature change against pH change', label: 'temperature against pH' },
        { img: barsPh, alt: 'Bar chart of pH change by container material', label: 'pH change by material' },
        { img: barsWaste, alt: 'Bar chart of total waste mass by bowl type', label: 'waste by bowl' },
      ],
    },
    {
      kind: 'gallery',
      subject: 'cs',
      title: 'The app',
      tall: true,
      imgs: [
        { img: appDash, alt: 'App screen: the data dashboard with the stalls’ locations', label: 'dashboard' },
        { img: appCharts, alt: 'App screen: charts of pH change by stall and total waste', label: 'charts' },
        { img: appRaw, alt: 'App screen: the raw data table and summary statistics', label: 'raw data' },
      ],
    },
    {
      kind: 'text',
      subject: 'cs',
      title: 'Conclusions',
      bullets: [
        'The visualisations showed that pH change, temperature change and waste mass differed between stalls.',
        'Mapping and graphs made those differences visible across locations and materials.',
        'They drew no conclusions about causes: they were only there to present the collected data clearly.',
      ],
    },

    {
      kind: 'text',
      title: 'Conclusion',
      bullets: [
        'How street food is handled and stored in Hyderabad directly affects its safety and its environmental impact.',
        'Poor storage or long exposure can shift acidity and temperature toward contamination, while material choices and disposables drive the daily waste.',
        'Mapping these patterns shows that simple changes to handling and packaging could improve both hygiene and sustainability.',
        'The findings tie to SDG 3 (health) and the wider goals: safer, more environmentally conscious practice across city neighbourhoods.',
      ],
      media: { img: vendor, alt: 'Illustration of the pani puri vendor at his cart', fit: 'cover' },
    },
    {
      kind: 'text',
      title: 'Reflection',
      bullets: ['Division of work', 'Communication', 'Adaptability', 'Data comprehension', 'Novel equipment', 'Language', 'Experimental limitations'],
      media: { img: panipuri, alt: 'Illustration of a plate of pani puri', fit: 'contain', bare: true },
    },
    {
      kind: 'refs',
      title: 'Bibliography',
      refs: [
        'https://ceramics.org/about/what-are-ceramics/structure-and-properties-of-ceramics/',
        'https://archive.nptel.ac.in/content/storage2/courses/113104005/lecture2/2_7.htm',
        'https://www.bioleaderpack.com/about-the-sugarcane-bagasse-tableware-degradation-method-process-and-time-how-to-store-them/',
        'https://www.greenmyna.com/dry-vs-wet-waste-in-india-a-complete-guide-to-segregation-disposal-and-everyday-example',
        'https://foodpackagingforum.org/news/how-to-increase-the-recyclability-of-paper-packaging',
        'https://pmc.ncbi.nlm.nih.gov/articles/PMC9407675/',
        'https://steemit.com/food/@teenz/great-indian-food-basket-1-pani-puri',
        'https://earth.google.com',
        'https://pmc.ncbi.nlm.nih.gov/articles/PMC8149962/',
        'https://academic.oup.com/jimb/article/12/3-5/190/5987851',
      ],
    },
    { kind: 'end', title: 'Thank you', sub: 'Group 20 · IBDP Collaborative Sciences Project' },
  ],
}
