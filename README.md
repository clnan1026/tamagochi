# tamagochi

A pixel-art virtual pet. One **shared pet engine** (`src/content/`) drives three hosts: a
desktop **app** (the main experience — a Talking Tom–style pet you care for), an Electron
**desktop overlay** (the pet roams your whole screen), and a Chrome **extension** (the pet
lives on web pages).

## Run it — desktop app (Electron)

```
npm install
npm start
```

Opens a portrait app window with a three-screen flow: **Start → Choose your friend →
Pet Room**. In the room the pet idles and roams, and you look after three stats:

- **HP ❤️** — full to start; only drops once Satiety hits 0, and slowly recovers once the pet
  is fed again.
- **Satiety 🍖** — drains over time; **Feed** refills it.
- **Stamina 🔋** — mirrors your **real laptop battery** (native `pmset` read). Low battery makes
  the pet sluggish and, when very low, tired/grumpy — the one thing a web pet can't do.

**Feed** and **Play** buttons react (a happy hop + a speech bubble); **tap the pet** to poke it;
drag/flick to toss it around the room. Everything is localized (EN/JP/KO); the menu-bar tray has
live battery %, character, language, and Quit. Stats persist between launches (with capped
offline decay, so you don't return to a dead pet).

> If `npm start` exits instantly with `app.getAppPath is undefined`, the shell has
> `ELECTRON_RUN_AS_NODE` set, which makes Electron run as plain Node. Launch with
> `env -u ELECTRON_RUN_AS_NODE npm start`.

The transparent **desktop-overlay** mode (`src/desktop/`) is still in the tree for a future
"release to desktop" button; it is not opened on launch.

## Run it — Chrome extension

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder

Open any page and the pet appears in the bottom-left. Same interactions as above.

## Layout

```
src/content/           shared pet engine — identical across all three hosts
  sprite.js            sheet loading + frame stepping
  pet.js               state machine (idle/walk/run/air/drag/hurt) + physics + poke/hop
  input.js             poke vs. drag, throw velocity

src/app/               desktop APP (primary): Start → Select → Pet Room
  index.html           the three screens
  app.css              design tokens (OS light/dark) + screens/stat bars/room
  app.js               screen router + Start/Select + language
  stats.js             HP / Satiety / Stamina model (+ offline decay, persistence)
  room.js              Pet Room controller: feed/play/poke, battery→stamina, behavior

electron/
  main.js              opens the app window; tray; battery (pmset); settings; overlay (later)
  preload.js           contextBridge: assets, settings, battery, interactivity

src/desktop/           desktop OVERLAY (secondary): transparent click-through pet
  index.html / overlay-desktop.js
  chrome-shim.js       fakes chrome.runtime/chrome.storage so src/content/ runs unchanged

src/options/           Chrome extension options page (character/language)
manifest.json          Chrome extension (MV3, content script on <all_urls>)
overlay.js (in src/content) — extension host overlay

assets/<character>/    pink | owlet | dude — idle, walk, run, jump, hurt, climb
```

All three hosts reuse `sprite.js` / `pet.js` / `input.js` verbatim; the only extension APIs
those files touch (`chrome.runtime.getURL`, `chrome.storage`) are provided by
[chrome-shim.js](src/desktop/chrome-shim.js) on top of the Electron bridge — one pet engine,
three hosts. `pet.js` takes an optional `getBounds` so the app's Pet Room confines the pet to
the room stage while the overlay/extension default to the full window.

The stat model ([stats.js](src/app/stats.js)) is host-agnostic plain JS (no DOM/chrome/Electron),
so its rules are unit-tested headlessly.

## Assets

Sprites are from a [CraftPix](https://craftpix.net/file-licenses/) pack, kept unmodified in
`tamagotchi-pixel-character/` and copied into `assets/`. **The license permits use but
forbids redistributing the assets themselves** — read it before making this repo public or
publishing to the Chrome Web Store. `PSD/`, `COUPON.*`, and the bundled font are not shipped
with the extension.
