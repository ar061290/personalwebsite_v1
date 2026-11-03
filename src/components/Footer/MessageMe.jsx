// "send a message" in the footer's contact column: a small popup that takes the visitor's name,
// their message and (optionally) how to reach them, and sends it the way the Drama Collective
// site's IA tracker sends its reminders (dramacollectivewebsite_v19/src/pages/ia.js), two ways at
// once:
// - a push to Aadi's phone through ntfy.sh (a free, open-source push service), one JSON message
//   posted to its root as text/plain, so the browser makes a simple request (no preflight). The
//   topic is the one his phone already listens to for the tracker;
// - an email through FormSubmit (formsubmit.co), which forwards it to his inbox. The first message
//   from each new address of the site comes back unsent: FormSubmit emails him a link to activate
//   it, once.
// A note at the foot of the screen says where it went; if neither went through it offers a plain
// email link instead. The name is remembered in this browser, so it is filled in next time.
import { useEffect, useId, useRef, useState } from 'react'
import { EMAIL } from '../../content/site.js'
import './MessageMe.css'

const NTFY = 'https://ntfy.sh/'
const NTFY_TOPIC = 'dc-ia-aadi-oiw2e0vjqb8fztd4'
const FORMSUBMIT = 'https://formsubmit.co/ajax/'
const KEY_NAME = 'aadi-message-name'
const TOAST_MS = 9000
const GIVE_UP_MS = 12000

const read = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // private window: asked again next time
  }
}
/** Text as typed, made safe to send: no control or direction characters, single spaces, capped. */
const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

async function push({ name, message, reply }, page, signal) {
  const res = await fetch(NTFY, {
    method: 'POST',
    // JSON to the root, as text/plain: a simple request; ntfy reads the topic from the body
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: `message from ${name} (your website)`,
      message: reply ? `${message}\n\nreply to: ${reply}` : message,
      tags: ['envelope'],
      priority: 4,
      click: page,
    }),
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal,
  })
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`)
  return true
}

async function mail({ name, message, reply }, page, signal) {
  // FormSubmit knows the form by the page's address (sent as the referrer, the origin only)
  const res = await fetch(FORMSUBMIT + EMAIL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      _subject: `message from ${name} (your website)`,
      _template: 'box',
      _captcha: 'false',
      // an email address given to reply to becomes the email's Reply-To
      ...(looksLikeEmail(reply) ? { email: reply } : {}),
      name,
      message: `${message}\n\n${reply ? `reply to: ${reply}\n` : ''}sent from ${page}`,
    }),
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    signal,
  })
  const out = await res.json().catch(() => null)
  // the very first one comes back unsent: FormSubmit has emailed a link to activate the form
  if (!res.ok || String(out?.success) !== 'true') throw new Error(`FormSubmit said ${out?.message ?? res.status}`)
  return true
}

const mailto = ({ name, message }) =>
  `mailto:${EMAIL}?subject=${encodeURIComponent(`message from ${name}`)}&body=${encodeURIComponent(message)}`

export default function MessageMe() {
  const id = useId()
  const dialogRef = useRef(null)
  const toastTimer = useRef(0)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState(null) // { text, action?: { text, href } }

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const showToast = (next, stay = false) => {
    clearTimeout(toastTimer.current)
    setToast(next)
    if (!stay) toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }

  const open = () => {
    setName(clean(read(KEY_NAME), 40))
    dialogRef.current?.showModal()
  }
  const close = () => dialogRef.current?.close()

  const onSubmit = async (e) => {
    e.preventDefault()
    if (sending) return // a press while one is still going
    const note = { name: clean(name, 40), message: clean(message, 1000), reply: clean(reply, 80) }
    if (!note.name || !note.message) return
    write(KEY_NAME, note.name)
    close()
    setSending(true)
    showToast({ text: 'sending your message…' }, true)
    const page = `${location.origin}${location.pathname}`
    const abort = new AbortController()
    const giveUp = setTimeout(() => abort.abort(), GIVE_UP_MS)
    const [p, m] = (await Promise.allSettled([push(note, page, abort.signal), mail(note, page, abort.signal)])).map((r) => {
      if (r.status === 'rejected') console.warn('send a message: one way did not go through', r.reason)
      return r.status === 'fulfilled' && r.value === true
    })
    clearTimeout(giveUp)
    setSending(false)
    if (p || m) {
      setMessage('')
      setReply('')
      showToast({ text: `sent to aadi's ${p && m ? 'phone and email' : p ? 'phone' : 'email'}. thanks, ${note.name}!` })
    } else {
      showToast({ text: 'that didn’t go through just now.', action: { text: 'email him instead', href: mailto(note) } })
    }
  }

  return (
    <>
      <button type="button" className="message-me" onClick={open} aria-busy={sending || undefined}>
        send a message <span aria-hidden="true">→</span>
      </button>

      <dialog
        ref={dialogRef}
        className="message-me__dialog"
        aria-labelledby={`${id}-title`}
        // a press on the dim backdrop around the popup closes it, as Escape does
        onClick={(e) => e.target === dialogRef.current && close()}
      >
        <form className="message-me__form" onSubmit={onSubmit}>
          <p className="message-me__title" id={`${id}-title`}>
            send aadi a message
          </p>
          <label className="message-me__field">
            <span>your name</span>
            <input
              name="name"
              type="text"
              autoComplete="name"
              maxLength={40}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="message-me__field">
            <span>message</span>
            <textarea name="message" rows={4} maxLength={1000} required value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label className="message-me__field">
            <span>how to reach you (optional)</span>
            <input
              name="reply"
              type="text"
              autoComplete="email"
              maxLength={80}
              placeholder="email, instagram, phone…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
          </label>
          <div className="message-me__actions">
            <button type="button" className="message-me__cancel" onClick={close}>
              cancel
            </button>
            <button type="submit" className="message-me__send" disabled={sending}>
              send
            </button>
          </div>
        </form>
      </dialog>

      <div className={`message-me__toast${toast ? ' is-shown' : ''}`} role="status" aria-live="polite">
        {toast ? (
          <>
            <span>{toast.text}</span>
            {toast.action ? (
              <a href={toast.action.href} target="_blank" rel="noopener noreferrer">
                {toast.action.text}
              </a>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  )
}
