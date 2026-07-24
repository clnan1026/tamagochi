# tamagochi

A pixel-art pet that wanders, jumps, can be picked up and thrown, and complains when you
poke it. It runs in two hosts that **share the same pet code** (`src/content/`): a Chrome
extension where it lives on web pages, and an Electron app where it roams your whole desktop.

## Run it — desktop (Electron)

```
npm install
npm start
```

The pet appears at the bottom of the screen and roams the desktop on top of every app. The
window is transparent and click-through, so it only intercepts the mouse when the cursor is
over the pet — clicks on empty space fall through to whatever is underneath. A **menu-bar/tray
icon** holds the character picker, language, live battery %, and Quit.

Click the pet to poke it; drag to pick it up; flick to throw. macOS battery level is read
natively (`pmset`) — this is what going desktop unlocks over the extension.

> If `npm start` exits instantly with `app.getAppPath is undefined`, the shell has
> `ELECTRON_RUN_AS_NODE` set, which makes Electron run as plain Node. Launch with
> `env -u ELECTRON_RUN_AS_NODE npm start`.

## Run it — Chrome extension

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder

Open any page and the pet appears in the bottom-left. Same interactions as above.

## What works today

Milestone 1: the pet, its physics, and pointer interaction. It renders in a shadow root at
`z-index: 2147483647`, so page CSS can't touch it and a strict `Content-Security-Policy`
can't block it. The overlay is click-through — only the sprite itself takes pointer events.

Still to come: walking on text, climbing, the options page, the to-do list, the hourly rest
reminder, and battery level as health.

## Layout

```
src/content/           shared pet — identical in both hosts
  sprite.js            sheet loading + frame stepping
  pet.js               state machine (idle/walk/run/air/drag/hurt) + physics + poke phrases
  input.js             poke vs. drag, throw velocity
  overlay.js           extension host: shadow-root, rAF loop, speech bubble

manifest.json          Chrome extension (MV3, content script on <all_urls>)

electron/              desktop host
  main.js              transparent click-through always-on-top window, tray, battery, settings
  preload.js           contextBridge: assets, settings, interactivity, battery
src/desktop/
  index.html           the pet window
  overlay-desktop.js   rAF loop + click-through toggling
  chrome-shim.js       fakes chrome.runtime/chrome.storage so src/content/ runs unchanged

assets/<character>/    idle, walk, run, jump, hurt, climb
```

The desktop host reuses `sprite.js` / `pet.js` / `input.js` verbatim. The only extension-only
API those files touch is `chrome.runtime.getURL` and `chrome.storage`, which
[chrome-shim.js](src/desktop/chrome-shim.js) provides on top of the Electron bridge — so there
is one pet, not two. Characters (`pink`, `owlet`, `dude`, `shinchan`) and language switch live
from the tray (desktop) or the options page (extension).

## Assets

Sprites are from a [CraftPix](https://craftpix.net/file-licenses/) pack, kept unmodified in
`tamagotchi-pixel-character/` and copied into `assets/`. **The license permits use but
forbids redistributing the assets themselves** — read it before making this repo public or
publishing to the Chrome Web Store. `PSD/`, `COUPON.*`, and the bundled font are not shipped
with the extension.
