// Source: public/Aadi_Ramnani_Resume.pdf (experience, research, technical skills).
export default {
  slug: 'research',
  number: '02',
  title: 'research & experience',
  lede: 'First-principles simulations of oxide interfaces at IIT Hyderabad, and machine learning on a production ed-tech platform.',
  sections: [
    {
      heading: 'research',
      entries: [
        {
          title: 'Research Intern, Computational Physics',
          org: 'Computational Physics Group, Prof. Manish K. Niranjan, IIT Hyderabad',
          when: 'Apr 2026 – present',
          note: '15–20 hrs/wk in summer; 8–10 hrs/wk in term.',
          points: [
            'Ran first-principles quantum-mechanical simulations of the LaAlO3/SrTiO3 oxide interface, where two bulk insulators meet to host a conducting 2-D electron gas: structural relaxations, density-of-states and zone-centre phonon calculations on thin superlattice models.',
            'Identified vibrational modes localised at the interface and reasoned that Raman spectroscopy could detect them; wrote Python scripts to process and analyse the simulation output.',
            'Co-author on a research manuscript in preparation for submission to a peer-reviewed journal.',
          ],
        },
        {
          title: 'Project AKS: a hypergolic rocket system feasibility study',
          org: 'Team lead · independent research',
          points: [
            'Led a systems-level feasibility study for a reusable UDMH–N2O4 rocket deployed by high-altitude balloon for near-space access (80–100 km): modelled injector and nozzle configurations, thrust profiles and mass–altitude trade-offs (the Tsiolkovsky equation), and evaluated regenerative and ablative thermal management under safety constraints.',
            'Presented the full technical proposal to school leadership; the project was halted after a permits review and is being prepared as a publicly citable preprint.',
          ],
        },
      ],
    },
    {
      heading: 'experience',
      entries: [
        {
          title: 'Machine Learning Intern',
          org: 'OrcaLex Technologies · SmartLearners.ai, Hyderabad',
          when: 'Summer 2025',
          note: 'A production AI platform used by ~20,000 students and 600 teachers.',
          links: [{ label: 'smartlearners.ai', href: 'https://smartlearners.ai' }],
          points: [
            'Improved how accurately a production vision-language model reads handwritten exam notation while cutting inference cost (token-generation speed on NVIDIA A100 GPUs), working as an experimentalist: one variable at a time (training method, data composition, decoding parameters) against teacher-marked ground truth.',
            'Tuned Supervised Fine-Tuning and GRPO reward functions, penalising needlessly long reasoning chains for denser, faster, cheaper outputs without losing marking accuracy; tracked character-level error, symbol-recovery rates and memory footprints across configurations.',
            'Carried the best checkpoints through to quantized edge-deployment formats; on finding that an analysis script had double-counted students, flagged and corrected it unprompted and re-ran the full analysis.',
          ],
        },
      ],
    },
    {
      heading: 'technical skills',
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
