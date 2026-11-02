# personalwebsite_v1

Personal website of **aadi ramnani**. Vite + React, with a WebGPU jelly watermelon on the home page.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

The watermelon needs a browser with WebGPU (Chrome/Edge 113+, Safari 26+). Other browsers get a static illustration instead.

## What's on the home page

- **Intro**: plays on the first open or a reload of any page, never on in-app navigation. It repeats the name, squashes it, squashes again, then opens onto the page.
- **Watermelon**: a soft-body jelly slice (Rosé variety). Grab it and pull to stretch it; it stays in place and wobbles back.
- **Fluid background**: a WebGL fluid sim behind the melon, inked in the melon's rose with a hint of rind green.
- **Googly eyes**: they follow the cursor, sit on top of the rind, and dock into the header as you scroll.
- **Cursor and stickers**: the cursor is replaced by a `+ click` label. Each click sticks a physics sticker or a Greek letter onto the page. Stickers land under the melon, and randomly either above or below the fluid (the first one always lands above).

## Layout

```
src/
  App.jsx                    intro + cursor + header + eyes + routes
  pages/Home.jsx             layer stack: stickers ↓, fluid, stickers ↑, hero
  components/
    Intro/                   name intro / loader
    Melon/                   WebGPU soft-body watermelon
    Fluid/                   fluid background
    Eyes/                    googly eyes
    Cursor/                  "+ click" cursor
    Stickers/                click-to-stick logic
    Header/, ScrollHint/
  assets/stickers/           sticker art + manifest
  lib/melonBus.js            lets other parts ask the melon about hit-testing and position
```

## Deploying

The site is a single-page app, so every route has to serve `index.html`. `vercel.json` already does this for Vercel. Netlify needs `/* /index.html 200` in `public/_redirects`.

## Credits

- Fluid simulation: [lumina-cursor](https://github.com/sebastianvasquezechavarria1234/lumina-cursor) (MIT, Sebastian Vasquez Echavarria), which builds on [WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT, Pavel Dobryakov).
- The watermelon is ported from the "Melon Jelly" WebGPU artifact.
- Inspiration: the intro from [sofaknows.com](https://sofaknows.com), the cursor and stickers from [vegan.ning-h.com](https://vegan.ning-h.com), and the eyes from Framer's cursor-follow-eyes component.
- Fonts: Archivo (SIL OFL), served from this repo.
