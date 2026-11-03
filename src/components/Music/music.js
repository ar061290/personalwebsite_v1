// Music, on by default: "a playlist to romanticize studying" (artist unknown), ported from the
// Drama Collective site (dramacollectivewebsite_v17/src/ui/music.js). The site opens with it
// playing unless the visitor has turned it off earlier in this visit, or has asked their browser to
// save data. No browser lets a page start sound before the visitor has done anything on it (a
// scroll does not count), so on a first page the button shows that it is waiting, and the music
// starts with the visitor's first tap, click or key anywhere on the page.
// It plays from the site's own MP3 (public/music/romanticize-studying.mp3) in a plain audio element.
// The file is the whole playlist (some 76 MB), so it is streamed: nothing of it is asked for until
// the music is wanted, and then only its first few bytes (the length) before playing from the
// chosen point, which the browser fetches from there on as it goes.
//
// Each page starts the music somewhere new: a random point in the playlist, never its very start
// and never where the last page had got to. This is a single-page app, so "each page" is each
// route: on a route change (reposition()) a playing track fades out, jumps to a new random point
// and fades back in. Whether the visitor wants it on is remembered for this visit (sessionStorage),
// along with where it had got to, so a reload also opens somewhere new. It fades in and out, and
// pauses while the tab is hidden.
//
// Besides the button, it answers the play and pause shortcuts people already use:
//   - the system's own media controls, through the browser's media session: media keys, a touchpad
//     gesture set to play/pause (a three-finger tap on many laptops), headset buttons, the browser's
//     and the phone's own controls. Playing it from there while the tab is hidden is heard there too
//     (the visitor asked for it); otherwise a hidden tab still pauses it.
//   - K on the page, as on video sites, wherever the visitor is not typing;
//   - a three-finger tap on a touch screen.
// All of them turn it on or off just as the button does (and are remembered as the button is); a
// pause from outside the page with no media session (a headset unplugged) counts as turning it off.
import gsap from 'gsap'

export const TRACK = {
  title: 'a playlist to romanticize studying',
  by: '',
}
const VOLUME = 0.6 // of full volume: background music, under the page
// shown with the track by the system's media controls
const ARTWORK = `${import.meta.env.BASE_URL}favicon.svg`
const FILE = `${import.meta.env.BASE_URL}music/romanticize-studying.mp3`
const KEY = 'aadi-music' // { on, t }: whether the visitor wants it, and where it had got to (seconds)
// the events that count as the visitor's own doing, inside which a browser lets music start. A touch's
// pointerdown is not one (its pointerup and touchend are), and Safari, like every browser on iOS, lets
// it start only inside a touchend or a click, so all of these are listened for.
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown']

// Another player on the page (the research page's video, Sections/VideoOverlay.jsx) holds the music
// while it is open: holdMusic(true) fades it out and pauses it without changing whether the visitor
// wants it, and holdMusic(false) brings it back (if it is still wanted). Nothing tries to start it
// while it is held.
const HOLD_EVENT = 'aadi:music-hold'
export const holdMusic = (on) => window.dispatchEvent(new CustomEvent(HOLD_EVENT, { detail: Boolean(on) }))

const read = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) ?? {}
  } catch {
    return {}
  }
}
const write = (v) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* private mode: it starts over */
  }
}

/**
 * A point to start from in a playlist `duration` seconds long: well clear of the start and the very
 * end, and at least a tenth of the playlist away from `last` (where the previous page had got to).
 */
function pickStart(duration, last) {
  const from = Math.min(30, duration * 0.03)
  const to = duration - Math.min(90, duration * 0.08)
  if (!(to > from)) return 0 // too short to choose from (it is never this short, but never throw)
  let t = from
  for (let i = 0; i < 8; i++) {
    t = from + Math.random() * (to - from)
    if (typeof last !== 'number' || Math.abs(t - last) > duration * 0.1) break
  }
  return t
}

const NOOP = { dispose() {}, reposition() {} }

/**
 * Wires the music to `button`. Returns { dispose, reposition }: reposition() is called on every
 * route change (a new page), and moves the music to a new random point.
 */
export function setupMusic({ button, reduced = false }) {
  if (!button) return NOOP

  let wanted = false // the visitor's choice; the audio may be briefly paused while the tab is hidden
  let blocked = false // wanted, but the browser would not let it start on its own: it waits for the visitor
  let audio = null
  let placed = false // whether this page's random starting point has been set
  let fade = null
  let waitGesture = null // while it is blocked: the next tap, click or key starts it
  const level = { v: 0 } // the volume being faded (0..VOLUME)
  let sounding = false // playing, as far as this page knows ('playing' to 'pause')
  let ownPause = false // a pause this page asked for, not one from outside (see 'pause')
  let fromAway = false // started from the system's controls while the tab is hidden: heard there too
  let multiTouch = false // a touch of two or more fingers is under way (or just ended)
  let everPlayed = false // played on this page at least once: the browser then sends media keys to its media session
  let moving = false // fading out to jump to a new point for a new page (reposition)
  let held = false // another player on the page is open: the music waits for it (holdMusic)
  const session = 'mediaSession' in navigator ? navigator.mediaSession : null
  const saveData = navigator.connection?.saveData === true // the visitor's browser asks to save data
  const last = read().t // where the previous page had got to, to start well away from it

  const nowPlaying = TRACK.by ? `${TRACK.title}, ${TRACK.by}` : TRACK.title
  const setUi = (state) => {
    // held back by the browser it is not playing, so it is not shown as on (nor as 'Now playing'):
    // it is marked out instead as waiting for the visitor, whose click on it then starts it
    const on = wanted && !blocked
    button.setAttribute('aria-pressed', String(on))
    button.classList.toggle('is-playing', on && state === 'playing')
    button.classList.toggle('is-loading', on && state === 'loading')
    button.classList.toggle('is-blocked', wanted && blocked)
    button.title = !wanted
      ? 'Play music (K)'
      : blocked
        ? 'Play music (K; your browser waits for a tap, click or key to start it)'
        : `Now playing: ${nowPlaying} (K to pause)`
    if (session) {
      try {
        session.playbackState = on && state === 'playing' ? 'playing' : audio ? 'paused' : 'none'
      } catch {
        /* older browsers */
      }
    }
  }

  const fadeTo = (to, duration, onComplete) => {
    fade?.kill()
    fade = gsap.to(level, {
      v: to,
      duration: reduced ? 0 : duration,
      ease: 'sine.inOut',
      onUpdate: () => {
        if (audio) audio.volume = Math.max(0, Math.min(1, level.v))
      },
      onComplete,
    })
  }

  // heard: unmuted (it is muted until it first really plays, see start) and faded up
  const rise = () => {
    if (!audio) return
    audio.muted = false
    // a hidden tab is given no frames to fade in (started there from the system's controls): set
    if (document.hidden) {
      fade?.kill()
      level.v = VOLUME
      audio.volume = VOLUME
      return
    }
    fadeTo(VOLUME, 1.6)
  }
  // every pause this page makes itself goes through here, so 'pause' can tell it from one from outside
  const halt = () => {
    if (!audio || audio.paused) return
    ownPause = true
    audio.pause()
  }

  const forgetGesture = () => {
    if (!waitGesture) return
    for (const type of GESTURES) document.removeEventListener(type, waitGesture, true)
    waitGesture = null
  }
  // autoplay was refused: start on the visitor's next tap, click or key anywhere but the music button
  // (whose click, in this state, starts it too: see toggle). The listener stays until the music is
  // really playing, as one tap brings several of these events and a browser may let only the last of
  // them start it.
  const awaitGesture = () => {
    if (waitGesture) return
    waitGesture = (e) => {
      if (button.contains(e.target)) return
      // the shortcuts start it themselves (K, a three-finger tap): this would start it, then the
      // shortcut would turn it off again
      if (e.type === 'keydown' && (isShortcut(e) || isMediaKey(e))) return
      if (multiTouch && e.type !== 'keydown') return
      if (wanted && audio?.paused && !document.hidden) play()
    }
    for (const type of GESTURES) document.addEventListener(type, waitGesture, true)
  }

  const play = () => {
    if (!audio) return
    // held by another player: it starts when that lets go (still wanted, it shows as on, not playing)
    if (held) {
      setUi('paused')
      return
    }
    if (!audio.paused) {
      // turned back on while still fading out: fade back in rather than pause at the end of it (or,
      // if it is still finding its place, leave that to 'playing')
      fade?.kill()
      moving = false
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && !audio.seeking) {
        setUi('playing')
        rise()
      } else setUi('loading')
      return
    }
    blocked = false
    setUi('loading')
    audio.play().catch((err) => {
      // turned off or paused for a hidden tab meanwhile, or another try (the same tap's next event) took
      if (!wanted || !audio?.paused || err?.name === 'AbortError') return
      if (err?.name === 'NotAllowedError') {
        blocked = true
        setUi('paused')
        awaitGesture()
      } else console.warn('Music could not start.', err)
    })
  }

  const build = () => {
    audio = new Audio()
    // only the length is asked for until it plays; then it streams from the chosen point
    audio.preload = 'metadata'
    audio.loop = true
    audio.volume = 0
    level.v = 0
    audio.addEventListener('playing', () => {
      sounding = true
      everPlayed = true
      blocked = false
      forgetGesture()
      // playing although it is off (resumed by the browser or the phone after it paused it, or after
      // a pause from outside), or while another player holds it (a start already under way when the
      // hold came): stopped, silently, so the button and what is heard agree
      if (!wanted || held) {
        fade?.kill()
        level.v = 0
        audio.volume = 0
        halt()
        return
      }
      setUi('playing')
      // only if it is still wanted: turned off while it was finding its place, it is stop()'s fade-out
      // that pauses it, and a fade up here would cut that short and leave it playing, the button off
      if (wanted && !moving && (!document.hidden || fromAway)) rise()
    })
    audio.addEventListener('waiting', () => setUi('loading'))
    audio.addEventListener('pause', () => {
      const own = ownPause
      ownPause = false
      // paused from outside the page while it was playing and in view (a headset unplugged, the
      // phone's own controls where there is no media session): the visitor's doing, so it is off
      if (!own && sounding && wanted && !document.hidden) {
        wanted = false
        forgetGesture()
        remember()
      }
      // stopped from outside with its level up: back to nothing, so it fades in when next turned on
      if (!own) {
        fade?.kill()
        level.v = 0
        if (audio) audio.volume = 0
      }
      sounding = false
      setUi('paused')
    })
    audio.addEventListener('error', () => {
      if (!audio?.error) return
      console.warn('Music could not load.', audio.error)
      wanted = false
      write({ on: false })
      teardown()
      setUi('paused')
    })
    // a new point in the playlist for this page, as soon as its length is known (it has been asked to
    // play already, and is muted or silent until it really does)
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (!placed && Number.isFinite(audio.duration)) {
          placed = true
          try {
            audio.currentTime = pickStart(audio.duration, last)
          } catch {
            /* not seekable here: it plays from the top */
          }
        }
      },
      { once: true },
    )
    audio.src = FILE
  }

  // Inside the visitor's click: the element is made and set playing there and then, not once its
  // length is in, since Safari (and every browser on iOS) lets audio start only inside the visitor's
  // own tap or click, and from then on lets that element play. Until it really plays, from its new
  // place, it is muted rather than only silent: iOS ignores volume, so the fade cannot hush it there.
  const start = () => {
    if (!audio) build()
    if (!placed) audio.muted = true
    play()
  }

  const teardown = () => {
    fade?.kill()
    forgetGesture()
    blocked = false
    moving = false
    if (!audio) return
    halt()
    audio.removeAttribute('src')
    audio.load() // drop the stream
    audio = null
    placed = false
  }

  const stop = () => {
    forgetGesture()
    blocked = false
    moving = false
    // not heard yet (still finding its place, or held back by the browser): nothing to fade, so it
    // stops at once; so it does in a hidden tab (paused there from the system's controls), which is
    // given no frames to fade out in. The level goes back to nothing, so it fades in when next on.
    if (!audio || audio.paused || level.v <= 0 || document.hidden) {
      fade?.kill()
      level.v = 0
      if (audio) audio.volume = 0
      halt()
      setUi('paused')
      return
    }
    // the element is kept, paused where it is: turned on again on this page, it carries on from there
    fadeTo(0, 0.6, () => {
      halt()
      setUi('paused')
    })
    // and if the tab is hidden during the fade (which is then given no frames), a timer, which still
    // runs there, finishes it
    const a = audio
    setTimeout(() => {
      if (wanted || audio !== a || a.paused) return
      fade?.kill()
      level.v = 0
      a.volume = 0
      halt()
      setUi('paused')
    }, 700)
  }

  const remember = () => {
    const t = audio && placed ? audio.currentTime : undefined
    write({ on: wanted, t: typeof t === 'number' ? t : last })
  }

  // the button answers at once; the audio's own events then say when it is really playing
  const turnOn = () => {
    // wanted already (held back by the browser, or paused while the tab was hidden): this, the
    // visitor's own doing, starts it
    if (wanted) {
      if (!audio || audio.paused) start()
      return
    }
    wanted = true
    remember()
    setUi('loading')
    start()
  }
  const turnOff = () => {
    if (!wanted) return
    wanted = false
    fromAway = false
    remember()
    setUi('paused')
    stop()
  }
  // held back by the browser, it is not on in the visitor's eyes: the button (or a shortcut) starts
  // it then, rather than turning it off
  const toggle = () => {
    if (wanted && !blocked && !(audio?.paused && document.hidden)) turnOff()
    else turnOn()
  }

  // ---- a new page: a new point ----
  // Playing and heard: faded out, moved, faded back in once it plays from there. Otherwise moved
  // silently (if it has its place yet), so it starts from the new point when it does.
  const jump = () => {
    if (!audio || !placed || !Number.isFinite(audio.duration)) return
    try {
      audio.currentTime = pickStart(audio.duration, audio.currentTime)
    } catch {
      /* not seekable here: it carries on */
    }
    remember()
  }
  const reposition = () => {
    if (!audio || !placed) return
    const heard = wanted && !blocked && !audio.paused && !document.hidden && level.v > 0
    if (!heard) {
      if (!moving) jump()
      return
    }
    moving = true
    fadeTo(0, 0.5, () => {
      if (!audio) return
      jump()
      moving = false
      if (!wanted || audio.paused) return
      // 'playing' fades it up if the jump had to wait for data; if it did not, 'seeked' does
      const up = () => {
        if (wanted && audio && !audio.paused && !moving && level.v < VOLUME * 0.5) rise()
      }
      audio.addEventListener('seeked', up, { once: true })
    })
  }

  // ---- held by another player (holdMusic) ----
  // On hold: faded out and paused, as a pause of this page's own (so it stays wanted). Let go: back on
  // if it is still wanted and the browser had let it play (if it is still waiting for the visitor's
  // first tap, it goes on waiting for one).
  const onHold = (e) => {
    const on = Boolean(e.detail)
    if (on === held) return
    held = on
    if (held) {
      moving = false
      if (!audio || audio.paused) return
      // not heard yet, or in a hidden tab (no frames to fade in): paused at once
      if (level.v <= 0 || document.hidden) {
        fade?.kill()
        level.v = 0
        audio.volume = 0
        halt()
        return
      }
      fadeTo(0, 0.4, () => {
        if (held) halt()
      })
      return
    }
    if (wanted && !blocked && audio && !document.hidden) play()
  }
  window.addEventListener(HOLD_EVENT, onHold)

  // ---- the shortcuts ----
  // K, wherever the visitor is not typing (and not with Ctrl, Alt or Cmd: those are the browser's). A
  // radio button or a checkbox takes no text, so K there is the shortcut too.
  const NOT_TEXT = ['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']
  function isShortcut(e) {
    if (e.key !== 'k' && e.key !== 'K') return false
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
    const el = e.target
    if (el?.tagName === 'INPUT') return NOT_TEXT.includes(el.type)
    return !el?.closest?.('textarea, select, [contenteditable]:not([contenteditable="false"])')
  }
  // the play/pause media keys (and a touchpad gesture set to send them) reach the page as keys while
  // nothing has played on it: the browser has no media session to give them to yet. Once the music
  // has played, the browser sends them to the session instead (ACTIONS below), never to both.
  function isMediaKey(e) {
    return !everPlayed && ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop'].includes(e.key)
  }
  const onKey = (e) => {
    if (e.repeat || e.defaultPrevented) return
    if (isMediaKey(e)) {
      if (e.key === 'MediaPlayPause') toggle()
      else if (e.key === 'MediaPlay') turnOn()
      else turnOff()
      return
    }
    if (isShortcut(e)) toggle()
  }
  // a three-finger tap: three fingers down together, none moved far, all lifted quickly. Its last
  // touchend is the visitor's own doing, inside which every browser lets the music start.
  let tap = null // { t0, max, starts: Map(id -> [x, y]), moved }
  const onTouchStart = (e) => {
    if (e.touches.length === e.changedTouches.length) {
      // a new touch: fingers already on the screen are not part of it
      multiTouch = false
      tap = { t0: e.timeStamp, max: 0, starts: new Map(), moved: false }
    }
    if (!tap) return
    for (const t of e.changedTouches) tap.starts.set(t.identifier, [t.clientX, t.clientY])
    tap.max = Math.max(tap.max, e.touches.length)
    if (e.touches.length >= 2) multiTouch = true
  }
  const onTouchMove = (e) => {
    if (!tap) return
    for (const t of e.changedTouches) {
      const s = tap.starts.get(t.identifier)
      if (s && Math.hypot(t.clientX - s[0], t.clientY - s[1]) > 24) tap.moved = true
    }
  }
  // once the last finger is off: the multi-finger touch's own events have gone by, so the next
  // click (a mouse, a touchpad) may start the music again
  const touchOver = () =>
    setTimeout(() => {
      multiTouch = false
    })
  const onTouchEnd = (e) => {
    if (!e.touches.length) touchOver()
    if (!tap || e.touches.length) return
    const t = tap
    tap = null
    if (t.max === 3 && !t.moved && e.timeStamp - t.t0 < 450) toggle()
  }
  const onTouchCancel = (e) => {
    tap = null
    if (!e.touches.length) touchOver()
  }
  document.addEventListener('keydown', onKey)
  document.addEventListener('touchstart', onTouchStart, { passive: true })
  document.addEventListener('touchmove', onTouchMove, { passive: true })
  document.addEventListener('touchend', onTouchEnd, { passive: true })
  document.addEventListener('touchcancel', onTouchCancel, { passive: true })

  // the system's own controls (media keys, touchpad gestures, headsets, the browser's and the phone's
  // controls): the same on and off. They reach the page once its music has played.
  // (pause and stop also stop it if it is still fading out, already off)
  const silence = () => {
    if (wanted) turnOff()
    else if (audio && !audio.paused) stop()
  }
  const ACTIONS = {
    play: () => {
      fromAway = document.hidden
      turnOn()
    },
    pause: silence,
    stop: silence,
  }
  if (session) {
    try {
      if (typeof MediaMetadata === 'function') {
        session.metadata = new MediaMetadata({
          title: TRACK.title,
          artist: TRACK.by,
          album: 'aadi ramnani',
          artwork: [{ src: ARTWORK, sizes: 'any', type: 'image/svg+xml' }],
        })
      }
    } catch {
      /* no metadata: the controls still work */
    }
    for (const [action, fn] of Object.entries(ACTIONS)) {
      try {
        session.setActionHandler(action, fn)
      } catch {
        /* an action this browser does not know */
      }
    }
  }

  const timer = setInterval(() => {
    if (wanted) remember()
  }, 2000)

  // the visitor's choice as stored for this visit (another tab of the site may have changed it since
  // this one was last in view, or this page is back from the back/forward cache)
  const storedWant = () => read().on ?? !saveData
  const onVisibility = () => {
    // hidden while it is still fading out, after being turned off: stopped at once (no frames there)
    if (document.hidden && audio && !wanted && !audio.paused) {
      fade?.kill()
      level.v = 0
      audio.volume = 0
      halt()
      setUi('paused')
      return
    }
    // back in view: if the visitor turned it on or off elsewhere meanwhile, that choice holds
    if (!document.hidden) {
      const want = storedWant()
      if (want !== wanted) {
        if (want) turnOn()
        else turnOff()
        return
      }
    }
    if (!wanted || !audio) return
    fromAway = false
    if (document.hidden) {
      remember()
      // paused at once, not faded: a fade is drawn frame by frame, and a hidden tab is given no frames,
      // so it would never reach its end (nor the pause there). The level goes back to nothing, so the
      // music fades in again when the tab is back.
      fade?.kill()
      moving = false
      level.v = 0
      audio.volume = 0
      halt()
    } else play()
  }

  const onPageShow = (e) => {
    if (!e.persisted) return
    const want = storedWant()
    if (want !== wanted) {
      if (want) turnOn()
      else turnOff()
    }
  }
  button.addEventListener('click', toggle)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('pagehide', remember)
  setUi('paused')

  // on unless the visitor turned it off earlier in this visit (or their browser is set to save data:
  // the playlist is a large file): from a new point. It is asked to play at once, silent (volume 0,
  // but not muted: a browser may let a muted start through, then stop it when it is unmuted), so that
  // a refusal shows on the button straight away, and the visitor's first tap, click or key starts it.
  if (storedWant()) {
    wanted = true
    build()
    if (document.hidden) setUi('paused')
    else play()
  }

  const dispose = () => {
    clearInterval(timer)
    if (wanted) remember()
    button.removeEventListener('click', toggle)
    window.removeEventListener(HOLD_EVENT, onHold)
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('touchstart', onTouchStart)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
    document.removeEventListener('touchcancel', onTouchCancel)
    if (session) {
      for (const action of Object.keys(ACTIONS)) {
        try {
          session.setActionHandler(action, null)
        } catch {
          /* unknown */
        }
      }
      try {
        session.metadata = null
        session.playbackState = 'none'
      } catch {
        /* older browsers */
      }
    }
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('pagehide', remember)
    teardown()
  }

  return { dispose, reposition }
}
