// Sources: public/Aadi_Ramnani_Resume.pdf (experience, research, technical skills); the activity
// list of his Common App / UIUC application (Oct 2026), which is newer where the two differ; and the
// Project AKS preprint (submitted to arXiv, Oct 2026) for the AKS brief. The ML internship also takes
// facts (never wording) from his supervisor's written account of the project (Oct 2026): the brief,
// the method, the hours and where the models run. Its bullets are his own claims in his own words
// (Nov 2026), which win over the letter's softer phrasing; its figure is redrawn from the
// "production inference path" card on his old site (aadi-portfolio-beta.vercel.app). The Ashwa
// Racing line is the ashwa page's own (src/content/ashwa.js), cut down.
import videoCover from '../assets/research/oxide-video-cover.webp'
import rockoon from '../assets/research/rockoon.webp'
// stills from the middle of each Ashwa Racing reel, him on camera (the CAD one at 64.5 s of 2:09, its
// exact middle; the CFD one at 49.6 s of 1:29, just past it, where the shoe's pressure plot is up)
import reelCad from '../assets/research/reel-cad.webp'
import reelCfd from '../assets/research/reel-cfd.webp'

// files in public/, under whatever base the site is built for (/ on Vercel, /personalwebsite_v1/ on Pages)
const pub = (path) => `${import.meta.env.BASE_URL}${path}`

export default {
  slug: 'research',
  number: '02',
  title: 'research & experience',
  // beside the title: a few turning unit cells of LaAlO3 on SrTiO3, the interface of the internship
  // below (ContentPage.jsx's HEAD_ART: Sections/Lattice.jsx)
  headArt: 'lattice',
  lede:'First-principles simulations of oxide interfaces at IIT Hyderabad, and machine learning on a production ed-tech platform.',
  sections: [
    {
      heading: 'research',
      entries: [
        {
          title: 'Research Intern, Computational Physics',
          org: 'Physics Group, Prof. Manish K. Niranjan, IIT Hyderabad',
          when: 'Apr 2026 – present',
          note: '15–20 hrs/wk in summer; 8–10 hrs/wk in term.',
          // the explainer, in the left column level with this entry only (it rides along while the
          // entry scrolls by, never down beside AKS): a card that opens it in a player over the page
          aside: {
            video: {
              src: pub('video/oxide-interfaces.mp4'),
              captions: pub('video/oxide-interfaces.vtt'),
              poster: videoCover,
              title: 'From IGCSE to Oxide Interfaces',
              caption: 'Learn about what I’m doing!',
              duration: 928, // seconds, shown before the file's own length is known
              // [start (s), title], from the video's own chapter list
              chapters: [
                [0, 'The story'],
                [27.4, '1. The maths'],
                [76.7, '2. Vibrations and waves'],
                [130.6, '3. Fields, charge and current'],
                [196.9, '4. Quantum mechanics'],
                [286.9, '5. Statistical physics'],
                [339.2, '6. Crystals and electron bands'],
                [424.8, '7. Phonons in crystals'],
                [475.4, '8. Beyond simple bands'],
                [541.6, '9. Electrons in two dimensions'],
                [605.3, '10. Oxide interfaces'],
                [711.9, '11. Heat at the nanoscale'],
                [811.2, '12. Density functional theory'],
                [908.1, 'Summary'],
              ],
            },
          },
          points: [
            'Simulating the LaAlO3/SrTiO3 interface: two crystals that are insulators on their own, but whose boundary conducts, hosting a high-mobility two-dimensional electron gas. The project looks for phonons (atomic vibrations) that live only at the interface, which could shape how heat crosses it and add to the picture of its other behaviour, superconductivity included.',
            'Ran first-principles (density functional theory) quantum-mechanical calculations on thin superlattice models: structural relaxations, electronic density of states and zone-centre phonon frequencies.',
            'Wrote and ran Python scripts to simulate the phonons and analyse the output, separating the modes bound to the interface from those of the bulk crystals.',
            'Found characteristic interface modes that Raman spectroscopy could detect: a prediction an experiment can test.',
            'Co-author on a research manuscript in preparation for submission to a peer-reviewed journal.',
          ],
        },
        {
          title: 'Project AKS: a hypergolic rocket system feasibility study',
          org: 'Team lead & co-author · CHIREC International School',
          when: '2022 – 2023',
          // die-cut, in the left column level with this entry (in the corner of its text on phones): the
          // balloon-and-rocket drawing from the proposal (its Figure 2)
          aside: {
            sticker: {
              src: rockoon,
              alt: 'Sticker of the rockoon from the proposal: a yellow hydrogen balloon lifting a grey rocket on two strings',
              tilt: 5,
            },
          },
          note: 'A rockoon: instead of launching from the ground, a hydrogen high-altitude balloon carries a reusable rocket to about 30 km, above most of the atmosphere, where it lights and climbs toward 100 km. Its propellants, UDMH and N2O4, are hypergolic: they ignite on contact, so there is no igniter to fail. The study works through propellant choice and hazards, materials, the feed system and engine cycle, a showerhead injector and an aerospike nozzle, five cooling strategies, propellant mass from the Tsiolkovsky equation, balloon lift, the permits a flight would need and a full bill of materials. The 2026 preprint keeps the 2022–23 proposal intact and adds an audit of its own maths, showing where the delta-v and buoyancy calculations break and what corrected figures look like.',
          points: [
            'Led a three-person team that designed the rockoon in grades 8–9, aiming for 100 km on a budget of about US$20,000.',
            'Modelled injector and nozzle configurations, thrust profiles and mass–altitude trade-offs (the Tsiolkovsky equation), and weighed regenerative, ablative and other cooling options under safety constraints.',
            'Presented the full proposal to the school principal, who commended it; it was halted over safety permits (with no expert supervision available and a carcinogenic fuel) and never left paper.',
            'Submitted to arXiv as a preprint in October 2026.',
          ],
          // `byTitle`: the same link also sits in the entry's header, just after its title, so the
          // site is in reach before the long note; the one under the points stays
          site: { label: 'visit the project site', href: 'https://aks.aadiramnani.world', byTitle: true },
        },
        {
          id: 'csp', // linked from the CSP award on the academics page
          title: 'IBDP Collaborative Sciences Project: a street-food safety study',
          org: 'Team lead',
          points: [
            'Led a multidisciplinary team across chemistry, biology and physics, and personally ran the heat-transfer modelling and thermodynamic analysis of real-world cooking and storage.',
            '1st place: “Outstanding Exploration and Integration of a Significant Global Scientific Issue.”',
          ],
        },
      ],
    },
    {
      heading: 'experience',
      entries: [
        // a pointer, not the story: a line from the ashwa page and the way there (like the drama
        // collective's entry on the leadership page). Newest first, so it leads the section.
        {
          title: 'Chief Aerodynamicist & Design Engineer, Ashwa Racing',
          org: 'STEM Racing / F1 in Schools · CO2-powered car',
          when: 'Sept 2025 – present',
          note: 'Designed the car and validated it in CFD across 3+ solvers: 2nd runner-up of 100+ teams at the South India Regionals, then 6th at Nationals.',
          links: [{ label: 'more on the ashwa page', to: '/ashwa' }],
        },
        {
          title: 'Machine Learning Intern',
          org: 'OrcaLex Technologies · SmartLearners.ai, Hyderabad',
          when: 'Summer 2025',
          note: 'A production AI platform that marks handwritten school exams with its own fine-tuned models, run in the cloud and on NVIDIA Jetson edge hardware; ~20,000 students and 600 teachers across several campuses. About 20 hrs/wk, April–June 2025.',
          links: [{ label: 'smartlearners.ai', href: 'https://smartlearners.ai' }],
          // the figure in the left column level with this entry (under its text on phones):
          // InferenceGraphic.jsx, which says what each part does. All of it is illustrative, as on
          // the old site's card: no measured values. Its words are here; the drawing is the component's.
          aside: {
            inference: {
              title: 'production inference path',
              // the path a script takes; `lit` is the stage every experiment acted on
              stages: ['handwritten exam', 'vision model', 'output tokens', 'teacher mark'],
              lit: 1,
              // the variables he isolated, one at a time: a card each, and the caption under the
              // cards while it is picked
              variables: [
                { name: 'training method', value: 'sft → grpo', caption: 'supervised fine-tuning vs. reward-tuned checkpoints, one at a time.' },
                { name: 'data composition', value: 'teacher-marked', caption: 'what the model sees, held constant everywhere else.' },
                { name: 'decoding parameters', value: 'length-penalised', caption: 'how long the reasoning chain is allowed to run.' },
              ],
              // the length penalty, sketched: a chain of `tokens`, drawn in `slots` cells across
              // the same width (the long one leaves 4 of its 26 unused; the dense one says the
              // same in 11 wider ones)
              reward: {
                title: 'reward shaping: long vs. dense reasoning',
                chains: [
                  { label: 'long chain', tokens: 22, slots: 26 },
                  { label: 'dense chain', tokens: 11, slots: 11, dense: true },
                ],
                note: 'penalising needless length keeps the mark, drops the cost.',
              },
              // the evaluation loop: [indent level, text]. The old card's end-of-line comments sit on
              // their own lines here, so the code fits the narrow column without scrolling sideways.
              code: {
                file: 'evaluate.py',
                lines: [
                  [0, 'for cfg in sweep:'],
                  [1, '# teacher-checked ground truth'],
                  [1, 'out = model.mark(batch)'],
                  [1, '# tracked per config'],
                  [1, 'cer = char_error(out, truth)'],
                  [1, 'sym = symbol_recovery(out, truth)'],
                  [1, 'mem = peak_memory(cfg)'],
                  [1, 'log(cfg, cer, sym, mem)'],
                ],
              },
            },
          },
          points: [
            'On an open-ended brief, improved the accuracy with which a production vision-language model reads handwritten exam notation (superscripts such as x², and where symbols sit on the page) while cutting its inference cost, measured as token-generation speed on NVIDIA A100 GPUs.',
            'Worked as an experimentalist: curated the training data and isolated one variable at a time (training method, data composition, decoding parameters), scoring each run against teacher-marked ground truth.',
            'Tuned supervised fine-tuning runs and GRPO reward functions, penalising needlessly long reasoning chains to produce denser, faster, cheaper outputs without losing marking accuracy.',
            'Tracked character-level error, symbol-recovery rates and memory footprints across configurations.',
            'Carried the best checkpoints through to quantized edge-deployment formats.',
            'On finding that an analysis script had double-counted students, flagged and corrected it unprompted and re-ran the full analysis.',
          ],
        },
      ],
    },
    {
      heading: 'technical skills',
      // under the label: the two Ashwa Racing reels as tilted prints, each opening on Instagram in a new
      // tab, with a pencilled note pointing at them (ReelCards in SectionSide.jsx). `label` is written
      // on the print's bottom margin; `length` (seconds) goes in the corner of the still.
      reels: [
        {
          href: 'https://www.instagram.com/p/Db8feSHRxSX/',
          thumb: reelCad,
          alt: 'Still from the CAD reel: Aadi talking to camera, under a cylindrical part modelled in Fusion 360',
          label: 'cad, explained',
          length: 129,
        },
        {
          href: 'https://www.instagram.com/p/DbGEctkxnO9/',
          thumb: reelCfd,
          alt: 'Still from the CFD reel: Aadi talking to camera, under a pressure plot of air flowing past a shoe',
          label: 'cfd, what is it?',
          length: 89,
        },
      ],
      reelsNote: 'reels we made for ashwa racing, to explain the engineering to everyone. i did the cfd + cad',
      list: [
        { title: 'Programming', org: 'Python (NumPy, Matplotlib), TypeScript, HTML5, CSS3' },
        { title: 'Scientific computing', org: 'First-principles / DFT workflows (structural relaxation, electronic density of states, zone-centre phonon frequencies); lattice dynamics' },
        { title: 'Machine learning', org: 'Supervised Fine-Tuning, Group Relative Policy Optimization (GRPO), reward shaping, model quantization & edge deployment' },
        { title: 'CFD & simulation', org: 'SimScale, OpenFOAM, SimFlow, BaramFlow, FluidX3D: flow visualisation, pressure distribution, boundary-layer separation' },
        { title: 'Engineering & CAD', org: 'Autodesk Fusion 360, FDM 3-D printing (material selection, print optimisation), rapid prototyping, iterative design cycles' },
      ],
    },
  ],
}
