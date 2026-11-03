// The research page's explainer video. In the section's left column it is a card (the cover, a play
// mark and a caption, printed like the photo slideshow); pressing it (or Enter / Space on it) opens
// the video in a player over the page: a native modal <dialog>, so the page behind is dimmed and
// inert and focus stays in the player. The ×, Escape and a press on the dim area around it close it;
// closing pauses the video and puts focus back on the card. The file (~55 MB) is only asked for
// when the player first opens, and it carries on from where it was if opened again.
//
// The controls are the site's own: play/pause, a seek bar (with the video's chapters marked) and the
// time, speed (0.75× to 2×, the current one lit), volume (a mute button, and a slider where the device
// lets a page set the volume: not on iPhones, which leave it to their buttons), captions (the .vtt
// beside the video) and fullscreen. While the player is open the keys are the video sites' usual
// ones: space or K play/pause, ← → seek 5 s, ↑ ↓ volume, M mute, C captions, F fullscreen. The
// speed, volume and captions this visitor chose are remembered for their next visit (localStorage).
//
// The site's background music waits while the player is open (holdMusic) and comes back after. The
// site's own cursor is drawn under the page's top layer, so the player shows the system's pointer.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { holdMusic } from '../Music/music.js'
import './VideoOverlay.css'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const SEEK_STEP = 5 // seconds, per ← →
const VOLUME_STEP = 0.05 // per ↑ ↓
const PREFS = 'aadi-video' // { rate, volume, muted, captions }

const readPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS)) ?? {}
  } catch {
    return {}
  }
}
const writePrefs = (prefs) => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs))
  } catch {
    /* private mode, blocked storage: it just isn't remembered */
  }
}

// iOS keeps a media element's volume at 1 whatever the page sets: the slider would do nothing there
const canSetVolume = () => {
  try {
    const v = document.createElement('video')
    v.volume = 0.5
    return v.volume === 0.5
  } catch {
    return false
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 75.4 → "1:15" */
const clock = (s) => {
  const t = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

const speedLabel = (r) => `${r}×`

/* ---- icons (24-unit boxes, drawn in currentColor) ---- */
const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    {children}
  </svg>
)
const PlayIcon = () => (
  <Icon>
    <path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5Z" fill="currentColor" />
  </Icon>
)
const PauseIcon = () => (
  <Icon>
    <rect x="5.5" y="4" width="4.5" height="16" rx="1" fill="currentColor" />
    <rect x="14" y="4" width="4.5" height="16" rx="1" fill="currentColor" />
  </Icon>
)
const VolumeIcon = ({ level }) => (
  <Icon>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    {level === 0 ? (
      <path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    ) : (
      <>
        <path d="M15.2 9.2a4 4 0 0 1 0 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        {level > 0.5 && (
          <path d="M17.8 6.6a7.6 7.6 0 0 1 0 10.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        )}
      </>
    )}
  </Icon>
)
const FullscreenIcon = ({ on }) => (
  <Icon>
    <path
      d={on ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Icon>
)
const CloseIcon = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none" />
  </Icon>
)

export default function VideoCard({ video }) {
  const { src, captions: captionsSrc, poster, title, caption, chapters = [] } = video
  const titleId = useId()

  const cardRef = useRef(null)
  const dialogRef = useRef(null)
  const stageRef = useRef(null) // what goes fullscreen: the video and its controls together
  const videoRef = useRef(null)
  const playRef = useRef(null)
  const seekRef = useRef(null)
  const railRef = useRef(null)
  const volumeRef = useRef(null)
  const scrubbing = useRef(false) // the seek bar is being dragged: the video follows it, not the other way
  const downOnBackdrop = useRef(false) // a press that began on the dim area (a drag ending there is not a close)

  const [prefs] = useState(() => {
    const p = readPrefs()
    return {
      rate: SPEEDS.includes(p.rate) ? p.rate : 1,
      volume: typeof p.volume === 'number' ? clamp(p.volume, 0, 1) : 1,
      muted: p.muted === true,
      captions: p.captions === true,
    }
  })
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(video.duration ?? 0)
  const [rate, setRate] = useState(prefs.rate)
  const [volume, setVolume] = useState(prefs.volume)
  const [muted, setMuted] = useState(prefs.muted)
  const [captions, setCaptions] = useState(prefs.captions)
  const [fullscreen, setFullscreen] = useState(false)
  const [volumeSlider] = useState(canSetVolume)
  const [canFullscreen, setCanFullscreen] = useState(false)

  // the played and loaded parts of the seek bar, and its thumb, set straight on the elements (every
  // frame while playing; React only redraws the clock, a few times a second)
  const sync = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : video.duration || 1
    const t = v.currentTime
    let loaded = 0
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= t + 0.5) loaded = Math.max(loaded, v.buffered.end(i))
    }
    const rail = railRef.current
    if (rail) {
      rail.style.setProperty('--played', String(clamp(t / d, 0, 1)))
      rail.style.setProperty('--loaded', String(clamp(loaded / d, 0, 1)))
    }
    if (!scrubbing.current && seekRef.current) seekRef.current.value = String(t)
  }, [video.duration])

  // the element's own state is the truth: everything on screen follows its events
  useEffect(() => {
    const v = videoRef.current
    if (!v) return undefined
    v.defaultPlaybackRate = prefs.rate
    v.playbackRate = prefs.rate
    v.volume = prefs.volume
    v.muted = prefs.muted
    const on = {
      play: () => setPlaying(true),
      pause: () => {
        setPlaying(false)
        setWaiting(false)
      },
      ended: () => setPlaying(false),
      waiting: () => setWaiting(true),
      playing: () => setWaiting(false),
      canplay: () => setWaiting(false),
      seeked: () => {
        setWaiting(false)
        sync()
      },
      timeupdate: () => {
        if (!scrubbing.current) setTime(v.currentTime)
        sync()
      },
      progress: sync,
      loadedmetadata: () => {
        if (Number.isFinite(v.duration)) setDuration(v.duration)
        sync()
      },
      durationchange: () => {
        if (Number.isFinite(v.duration)) setDuration(v.duration)
      },
      ratechange: () => setRate(v.playbackRate),
      volumechange: () => {
        setVolume(v.volume)
        setMuted(v.muted)
      },
      error: () => {
        if (v.error) setFailed(true)
      },
    }
    for (const [type, fn] of Object.entries(on)) v.addEventListener(type, fn)
    return () => {
      for (const [type, fn] of Object.entries(on)) v.removeEventListener(type, fn)
    }
  }, [prefs, sync])

  // smooth seek bar while it plays
  useEffect(() => {
    if (!open || !playing) return undefined
    let raf = 0
    const tick = () => {
      sync()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, playing, sync])

  // remembered for next time
  useEffect(() => {
    writePrefs({ rate, volume, muted, captions })
  }, [rate, volume, muted, captions])

  // captions: the track is only fetched once they are on in an open player
  useEffect(() => {
    if (!open) return
    const track = videoRef.current?.textTracks?.[0]
    if (track) track.mode = captions ? 'showing' : 'disabled'
  }, [captions, open])

  useEffect(() => {
    const v = videoRef.current
    setCanFullscreen(Boolean(document.fullscreenEnabled || v?.webkitEnterFullscreen))
    const onFs = () => setFullscreen(Boolean(stageRef.current) && document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // leaving the page with the player open (the browser's back button): let the music go
  useEffect(() => {
    if (!open) return undefined
    return () => {
      holdMusic(false)
      document.documentElement.classList.remove('vplayer-lock')
    }
  }, [open])

  /* ---- actions ---- */
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused || v.ended) {
      setFailed(false)
      v.play().catch(() => {
        /* refused or interrupted: the big play button stays up */
      })
    } else v.pause()
  }, [])

  const seekTo = (t) => {
    const v = videoRef.current
    if (!v) return
    const d = Number.isFinite(v.duration) ? v.duration : duration
    v.currentTime = clamp(t, 0, Math.max(0, d - 0.25))
    setTime(v.currentTime)
    sync()
  }
  const seekBy = (dt) => seekTo((videoRef.current?.currentTime ?? 0) + dt)

  const setLevel = (level) => {
    const v = videoRef.current
    if (!v) return
    v.volume = clamp(level, 0, 1)
    v.muted = v.volume === 0
  }
  const changeVolume = (dv) => {
    const v = videoRef.current
    if (!v) return
    setLevel((v.muted ? 0 : v.volume) + dv)
  }
  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    if (v.muted || v.volume === 0) {
      v.muted = false
      if (v.volume === 0) v.volume = 0.6
    } else v.muted = true
  }
  const pickSpeed = (r) => {
    const v = videoRef.current
    if (!v) return
    v.defaultPlaybackRate = r
    v.playbackRate = r
  }
  const toggleFullscreen = () => {
    const v = videoRef.current
    const stage = stageRef.current
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (document.fullscreenEnabled && stage?.requestFullscreen) {
      stage.requestFullscreen().catch(() => {})
    } else if (v?.webkitEnterFullscreen) {
      // iPhone: no fullscreen for a page's own elements, only the system's player
      v.webkitEnterFullscreen()
    }
  }

  const openPlayer = () => {
    const dialog = dialogRef.current
    const v = videoRef.current
    if (!dialog || !v || dialog.open) return
    // the file is first asked for here, inside the visitor's press, so it may start with sound
    if (!v.getAttribute('src')) {
      v.src = src
      v.defaultPlaybackRate = rate
      v.playbackRate = rate
    }
    dialog.showModal()
    setOpen(true)
    holdMusic(true)
    document.documentElement.classList.add('vplayer-lock')
    playRef.current?.focus({ preventScroll: true })
    togglePlay()
  }
  const closePlayer = () => dialogRef.current?.close()

  // however it closes (×, Escape, the dim area, close()): paused, the music let go, focus home
  const onClose = () => {
    videoRef.current?.pause()
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setOpen(false)
    holdMusic(false)
    document.documentElement.classList.remove('vplayer-lock')
    cardRef.current?.focus({ preventScroll: true })
  }

  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return
    const onButton = e.target instanceof HTMLButtonElement
    const onVolume = e.target === volumeRef.current // its own arrow keys move it
    switch (e.key) {
      case ' ':
        if (onButton) return // the focused control's own press
        togglePlay()
        break
      case 'k':
      case 'K':
        togglePlay()
        break
      case 'ArrowLeft':
      case 'ArrowRight':
        if (onVolume) return
        seekBy(e.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP)
        break
      case 'ArrowUp':
      case 'ArrowDown':
        if (onVolume) return
        changeVolume(e.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP)
        break
      case 'm':
      case 'M':
        toggleMute()
        break
      case 'c':
      case 'C':
        setCaptions((c) => !c)
        break
      case 'f':
      case 'F':
        toggleFullscreen()
        break
      default:
        return
    }
    // handled here: not also the page's (K is also the music's shortcut; space would scroll)
    e.preventDefault()
    e.stopPropagation()
  }

  const shownDuration = duration || video.duration || 0
  const level = muted ? 0 : volume
  let chapter = null
  for (const [start, name] of chapters) if (start <= time + 0.25) chapter = name
  const minutes = Math.round((video.duration ?? 0) / 60)

  return (
    <>
      <button
        ref={cardRef}
        type="button"
        className="side-video"
        onClick={openPlayer}
        aria-haspopup="dialog"
        aria-label={`${caption} Play the video “${title}”${minutes ? `, ${minutes} minutes` : ''}.`}
        data-cursor="play"
      >
        <span className="side-video__print">
          <span className="side-video__frame">
            <img src={poster} alt="" draggable="false" loading="lazy" decoding="async" />
            <span className="side-video__play" aria-hidden="true">
              <PlayIcon />
            </span>
            {video.duration ? (
              <span className="side-video__length" aria-hidden="true">
                {clock(video.duration)}
              </span>
            ) : null}
          </span>
          <span className="side-video__caption">{caption}</span>
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className="vplayer"
        aria-labelledby={titleId}
        onClose={onClose}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          downOnBackdrop.current = e.target === e.currentTarget
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && downOnBackdrop.current) closePlayer()
        }}
      >
        <div ref={stageRef} className={`vplayer__stage${fullscreen ? ' is-fullscreen' : ''}`}>
          <div className="vplayer__top">
            <p className="vplayer__title">
              <span id={titleId}>{title}</span>
              {chapter && <span className="vplayer__chapter">{chapter}</span>}
            </p>
            <button type="button" className="vplayer__btn vplayer__close" onClick={closePlayer} aria-label="Close the video (Esc)">
              <CloseIcon />
            </button>
          </div>

          <div className={`vplayer__screen${playing ? ' is-playing' : ''}`}>
            <video
              ref={videoRef}
              preload="none"
              playsInline
              poster={poster}
              onClick={togglePlay}
              onDoubleClick={toggleFullscreen}
            >
              <track kind="captions" src={captionsSrc} srcLang="en" label="English" />
            </video>
            {!playing && !failed && (
              <button type="button" className="vplayer__big" onClick={togglePlay} tabIndex={-1} aria-hidden="true">
                <PlayIcon />
              </button>
            )}
            {playing && waiting && <span className="vplayer__spinner" aria-hidden="true" />}
            {failed && <p className="vplayer__error">the video couldn’t load just now. try again in a bit.</p>}
          </div>

          <div className="vplayer__bar">
            <div className="vplayer__seek">
              <div ref={railRef} className="vplayer__rail" aria-hidden="true">
                {shownDuration > 0 &&
                  chapters.slice(1).map(([start]) => (
                    <span key={start} className="vplayer__mark" style={{ left: `${(start / shownDuration) * 100}%` }} />
                  ))}
              </div>
              <input
                ref={seekRef}
                type="range"
                className="vplayer__range"
                min="0"
                max={shownDuration || 1}
                step="any"
                defaultValue="0"
                aria-label="Seek"
                aria-valuetext={`${clock(time)} of ${clock(shownDuration)}${chapter ? `, ${chapter}` : ''}`}
                onPointerDown={() => {
                  scrubbing.current = true
                }}
                onPointerUp={() => {
                  scrubbing.current = false
                }}
                onPointerCancel={() => {
                  scrubbing.current = false
                }}
                onBlur={() => {
                  scrubbing.current = false
                }}
                onChange={(e) => seekTo(Number(e.target.value))}
              />
            </div>

            <button
              ref={playRef}
              type="button"
              className="vplayer__btn"
              onClick={togglePlay}
              aria-label={playing ? 'Pause (k)' : 'Play (k)'}
              aria-keyshortcuts="k Space"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <p className="vplayer__time">
              <span>{clock(time)}</span> / <span>{clock(shownDuration)}</span>
            </p>
            <span className="vplayer__spacer" />

            <div className="vplayer__speeds" role="group" aria-label="Playback speed">
              {SPEEDS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="vplayer__speed"
                  aria-pressed={rate === r}
                  aria-label={`${r} times speed`}
                  onClick={() => pickSpeed(r)}
                >
                  {speedLabel(r)}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="vplayer__btn vplayer__cc"
              aria-pressed={captions}
              aria-label="Captions (c)"
              aria-keyshortcuts="c"
              onClick={() => setCaptions((c) => !c)}
            >
              <span aria-hidden="true">CC</span>
            </button>

            <div className="vplayer__volume">
              <button
                type="button"
                className="vplayer__btn"
                onClick={toggleMute}
                aria-label={level === 0 ? 'Unmute (m)' : 'Mute (m)'}
                aria-keyshortcuts="m"
              >
                <VolumeIcon level={level} />
              </button>
              {volumeSlider && (
                <input
                  ref={volumeRef}
                  type="range"
                  className="vplayer__range vplayer__level"
                  min="0"
                  max="1"
                  step={VOLUME_STEP}
                  value={level}
                  style={{ '--level': level }}
                  aria-label="Volume"
                  aria-valuetext={`${Math.round(level * 100)}%`}
                  onChange={(e) => setLevel(Number(e.target.value))}
                />
              )}
            </div>

            {canFullscreen && (
              <button
                type="button"
                className="vplayer__btn"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}
                aria-keyshortcuts="f"
              >
                <FullscreenIcon on={fullscreen} />
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  )
}
