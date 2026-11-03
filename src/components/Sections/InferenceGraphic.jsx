// The figure beside the machine-learning internship (research.js: that entry's aside.inference),
// redrawn from the "production inference path" card on Aadi's old site (aadi-portfolio-beta.vercel.app)
// in this site's hand: ink and hairline rules on the paper, Archivo, the accent only where the old card
// lit something, and a mono only for the code and the token counts. The words are research.js's.
//
// What it keeps from the old card, interaction for interaction:
//  - the path an exam script takes: four stages joined by arrows, the vision model lit (every
//    experiment acted on it). Static, as it was; to a screen reader, an ordered list.
//  - the three variables, one at a time: a card each, a toggle button (aria-pressed). Pointing at a
//    card, focusing it (Tab) or pressing it picks it, and it stays picked when the pointer leaves, as
//    on the old card; the caption under the cards changes to say what that variable is (and is read
//    out, politely). The caption box keeps the height of the longest caption, so nothing below jumps.
//  - reward shaping: a long chain (22 tokens, in 26 slots) against a dense one (11 tokens, each
//    wider: the same answer in fewer tokens). The first time it comes into view the tokens fade up
//    from faint, left to right, 18 ms apart over 0.3 s each (the old card's numbers).
//  - evaluate.py, the evaluation loop, labelled illustrative like the sketch above it.
//
// It is laid out by its own width (a container query on .infer), not the window's: narrow in the left
// column on desktops, full width under its entry on phones, the cards side by side once there is
// room for three. Nothing in it scrolls sideways: the stages wrap after an arrow, and a code line too
// long for the column wraps under itself with a hanging indent. Reduced motion: no fade, no easing.
import { useEffect, useId, useRef, useState } from 'react'
import './InferenceGraphic.css'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// a code line, with the Python keywords picked out (the loop's `for … in`)
const KEYWORD = /\b(for|in)\b/
function CodeLine({ text }) {
  if (text.startsWith('#')) return <span className="infer__code-comment">{text}</span>
  return text.split(KEYWORD).map((part, i) =>
    i % 2 ? (
      <span key={i} className="infer__code-kw">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/** "illustrative": the old card's flag that nothing here is a measured value. */
function Illustrative() {
  return <span className="infer__flag">illustrative</span>
}

export default function InferenceGraphic({ figure }) {
  const { title, stages = [], lit, variables = [], reward, code } = figure
  const titleId = useId()
  const [active, setActive] = useState(0)

  // the token rows fade up once, the first time they are on screen (at once with reduced motion,
  // or where there is no IntersectionObserver)
  const rewardRef = useRef(null)
  const [tokensIn, setTokensIn] = useState(false)
  useEffect(() => {
    const el = rewardRef.current
    if (!el) return undefined
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setTokensIn(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        setTokensIn(true)
        io.disconnect()
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const picked = variables[active]

  return (
    <figure className="infer" aria-labelledby={titleId}>
      <figcaption id={titleId} className="infer__title">
        {title}
      </figcaption>

      <ol className="infer__path" aria-label={`${title}: ${stages.join(', then ')}`}>
        {stages.map((s, i) => (
          <li key={s} className="infer__stage">
            <span className={`infer__node${i === lit ? ' is-lit' : ''}`}>{s}</span>
            {i < stages.length - 1 && (
              <span className="infer__arrow" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      {variables.length > 0 && (
        <>
          <div className="infer__vars" role="group" aria-label="One variable at a time">
            {variables.map((v, i) => (
              <button
                key={v.name}
                type="button"
                className="infer__var"
                aria-pressed={active === i}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
              >
                <span className="infer__var-num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="infer__var-name">{v.name}</span>
                <span className="infer__var-value">{v.value}</span>
              </button>
            ))}
          </div>

          {/* every caption sits in the same cell, hidden, holding the box at the tallest one's height;
              the picked one is drawn over them (and is the one read out) */}
          <div className="infer__caption">
            {variables.map((v) => (
              <p key={v.name} className="infer__caption-sizer" aria-hidden="true">
                {v.caption}
              </p>
            ))}
            <p className="infer__caption-text" aria-live="polite">
              <span key={active} className="infer__caption-in">
                {picked.caption}
              </span>
            </p>
          </div>
        </>
      )}

      {reward && (
        <div ref={rewardRef} className={`infer__reward${tokensIn ? ' is-in' : ''}`}>
          <p className="infer__panel-head">
            <span>{reward.title}</span>
            <Illustrative />
          </p>
          {reward.chains.map((ch) => (
            <div key={ch.label} className={`infer__chain${ch.dense ? ' is-dense' : ''}`}>
              <p className="infer__chain-label">
                <span>{ch.label}</span>
                <span className="infer__chain-count">{ch.tokens} tokens</span>
              </p>
              <span className="infer__tokens" aria-hidden="true">
                {Array.from({ length: ch.slots }, (_, i) => (
                  <span key={i} className={`infer__token${i < ch.tokens ? ' is-used' : ''}`} style={{ '--n': i }} />
                ))}
              </span>
            </div>
          ))}
          <p className="infer__reward-note">{reward.note}</p>
        </div>
      )}

      {code && (
        <div className="infer__code">
          <p className="infer__code-head">
            <span className="infer__code-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="infer__code-file">{code.file}</span>
            <Illustrative />
          </p>
          <pre className="infer__code-body">
            <code>
              {code.lines.map(([indent, text], i) => (
                <span key={i} className="infer__code-line" style={{ '--in': indent }}>
                  {'    '.repeat(indent)}
                  <CodeLine text={text} />
                </span>
              ))}
            </code>
          </pre>
        </div>
      )}
    </figure>
  )
}
