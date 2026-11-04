// The physics of eating a 5 Star, one entry per stage of the stop motion (FiveStarFeast.jsx), shown in
// the strip under the bar: `frames` are the frames the stage covers (it lights up as they are reached).
const fiveStarPhysics = [
  {
    name: 'tear',
    title: 'Creating a tear in the wrapper',
    topics: 'Tensile stress · Fracture mechanics',
    frames: [2, 3],
    lead: 'At first the wrapper is a continuous, thin, flexible material. To open it, a pulling force is applied to a small section near the edge.',
    points: [
      'The pull creates tensile stress in the wrapper, and the material stretches.',
      'Because the force is concentrated on a small region, the local stress is high.',
      'A small cut or notch concentrates stress: around its tip the stress is much higher than in the material around it.',
      "Once the local stress exceeds the material's resistance to fracture, the wrapper starts to tear.",
      'The tear runs through the wrapper as the force keeps being applied.',
    ],
    close: 'The first tear makes the rest easier, because the stress now gathers at the tip of the new crack.',
  },
  {
    name: 'peel',
    title: 'Pulling the wrapper back, like a banana peel',
    topics: 'Peeling mechanics · Bending · Fracture propagation',
    frames: [4, 5],
    lead: 'Once the tear has started, the wrapper is pulled backwards and folds away from the chocolate. This is different from simply pulling the wrapper apart.',
    points: [
      'The pull puts the wrapper under tension.',
      'The wrapper bends sharply where the peeled part meets the part still around the bar.',
      'That bend concentrates stress at the peeling front.',
      'As the pull continues, the point of separation moves along the wrapper.',
      'The peeled part folds back while the rest stays around the chocolate.',
    ],
    close:
      'This is peel fracture: separation that moves through a material as it is pulled off what it covers. The wrapper is flexible enough to bend without breaking into pieces, and the work of pulling goes into bending it, running the tear, and overcoming any adhesion between the layers. It folds back a little at a time, not in one go.',
  },
  {
    name: 'pull out',
    title: 'Pulling the bar out of the wrapper',
    topics: "Friction · Normal force · Newton's laws",
    frames: [6, 6],
    lead: 'With most of the wrapper peeled back, the chocolate can be slid out of what is left. The main thing holding it back is friction.',
    points: [
      'Where the wrapper touches the chocolate, it presses on it (a normal force).',
      'That pressure produces friction, which resists the bar sliding.',
      'To move the bar, the pull has to overcome that friction.',
      'Once the pull is greater than the friction, the bar slides out.',
    ],
    close:
      'Peeling the wrapper back shrinks the contact area and the grip, which makes the bar easier to pull out. How fast it comes out depends on the difference between the pull and the friction: the net force accelerates it.',
  },
  {
    name: 'bite',
    title: 'Biting the bar',
    topics: 'Contact mechanics · Compression · Shear · Fracture',
    frames: [7, 8],
    lead: 'A bite is several mechanical processes happening almost at once.',
    points: [
      'Contact: the teeth press on the chocolate. Their tips touch only a small area, so the pressure there is high, and the chocolate deforms just under them.',
      'Penetration: as the teeth push on, the outer coating is compressed and the chocolate beneath deforms more and more. When it can no longer take the stress, a crack forms. The coating can snap quite suddenly, while the softer filling stretches more before it separates.',
      'Breaking: the crack runs through the coating and then the filling, driven by a mix of compression, tension and shear, until it crosses the whole bar and the bite comes away.',
      'The second bite: the same again, but the bar is shorter now, held differently, so the stresses are spread differently from the first bite.',
    ],
    close: '',
  },
]

export default fiveStarPhysics
