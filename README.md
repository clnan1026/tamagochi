# tamagochi

A pixel-art pet that lives on top of your web pages. It wanders, jumps, can be picked up
and thrown, and complains when you poke it.

## Run it

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder

Open any page and the pet appears in the bottom-left. Click it to poke; drag it to pick it
up; flick it to throw.

## What works today

Milestone 1: the pet, its physics, and pointer interaction. It renders in a shadow root at
`z-index: 2147483647`, so page CSS can't touch it and a strict `Content-Security-Policy`
can't block it. The overlay is click-through — only the sprite itself takes pointer events.

Still to come: walking on text, climbing, the options page, the to-do list, the hourly rest
reminder, and battery level as health.

## Layout

```
manifest.json        MV3; content script on <all_urls>
src/content/
  sprite.js          sheet loading + frame stepping
  pet.js             state machine (idle/walk/run/air/drag/hurt) + physics
  input.js           poke vs. drag, throw velocity
  overlay.js         shadow-root host, rAF loop, speech bubble
assets/<character>/  idle, walk, run, jump, hurt, climb
```

Three characters ship in `assets/`: `pink`, `owlet`, `dude`. Switch by changing `CHARACTER`
in [overlay.js](src/content/overlay.js) until the options page lands.

## Assets

Sprites are from a [CraftPix](https://craftpix.net/file-licenses/) pack, kept unmodified in
`tamagotchi-pixel-character/` and copied into `assets/`. **The license permits use but
forbids redistributing the assets themselves** — read it before making this repo public or
publishing to the Chrome Web Store. `PSD/`, `COUPON.*`, and the bundled font are not shipped
with the extension.
