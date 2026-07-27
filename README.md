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

Opens a portrait app window with a four-screen flow: **Start → Choose your friend →
Pet Room ⇄ Pomodoro**. In the room the pet idles and roams, and you look after three stats:

- **HP ❤️** — full to start; only drops once Satiety hits 0, and slowly recovers once the pet
  is fed again. Reaching 0 faints the pet (a real game over) until you hit **Revive**.
- **Satiety 🍖** — drains over time; feeding refills it.
- **Stamina 🔋** — mirrors your **real laptop battery** (native `pmset` read). Low battery makes
  the pet sluggish and, when very low, tired/grumpy — the one thing a web pet can't do.

**Feeding and playing work like Pou** — there's no Feed/Play button. Owned food/toy items sit in
a tray at the bottom; **drag one onto the pet** to use it (miss, and it snaps back to the tray).
Which tray you see depends on the room: the **Kitchen** shows food, any **Field** room shows
toys. A 🪙 **coin economy** ties it together — coins drop from playing/feeding, from random
pickups that pop up in Field rooms, and from tapping the 💩 the pet leaves behind (cleaning it up
is a pure bonus, no downside for ignoring it). Spend coins in the **Shop** (Food/Toys/Rooms tabs)
on better meals, toys that change what Play actually does, and new rooms — purchased rooms join
the swipeable rotation the Field Swiper already had for Basic/Game Field. **Tap the pet** to poke
it; drag/flick to toss it; it also pushes a **rock** prop around while wandering, and occasionally
busts out an idle flourish (a throw or a flex) even when you're not interacting. Everything is
localized (EN/JP/KO); the menu-bar tray has live battery %, character, language, and Quit. Stats
and the economy persist between launches (with capped offline decay — a long absence can find the
pet fainted, not just hungry).

The ⏰ button (both the room's topbar and the Field Swiper's Alarm button) opens a **Pomodoro
timer** — two modes, Pomodoro and Break, each defaulting to 25/5 min but freely editable via the
⚙ next to the tabs (1–180 min, locked while a session is running) — with a simple 4-slot
**task list** below it. The countdown is wall-clock based and keeps running in the
background even if you leave the Pomodoro screen to go play with the pet — when a session ends, a
5-second synthesized alarm tone plays (Web Audio, no sound file) and the pet reacts wherever you
are in the app. **Right-click the pet** to reveal your current (first unchecked) task as a tag
near it.

> If `npm start` exits instantly with `app.getAppPath is undefined`, the shell has
> `ELECTRON_RUN_AS_NODE` set, which makes Electron run as plain Node. Launch with
> `env -u ELECTRON_RUN_AS_NODE npm start`.

The transparent **desktop-overlay** mode (`src/desktop/`) opens alongside the app window — a
click-through pet roaming the whole screen, sharing the same engine and assets.

## Run it — Chrome extension

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder

Open any page and the pet appears in the bottom-left. Same interactions as above.

## Layout

```
src/content/           shared pet engine — identical across all three hosts
  sprite.js            sheet loading + frame stepping (15 animations per character)
  pet.js               state machine (idle/walk/run/air/drag/hurt/react/dead) + physics +
                        poke/eat/playful/die/revive + idle personality flourishes
  input.js             poke vs. drag, throw velocity

src/app/               desktop APP (primary): Start → Select → Pet Room ⇄ Pomodoro
  index.html           the four screens
  app.css              design tokens (OS light/dark) + screens/stat bars/room/pomodoro
  app.js               screen router + Start/Select + language + Pomodoro driver + tasks
  stats.js             HP / Satiety / Stamina model (+ offline decay, persistence, revive)
  room.js              Pet Room controller: drag-to-feed/play, room list + tray-type
                        switching, coin/poop spawns, Shop rendering, game-over/revive,
                        rock + dust effects, battery→stamina, alarm reaction, task reveal
  economy.js           Economy model + catalog: coins, consumable food, one-time
                        toy/room unlocks — host-agnostic, mirrors stats.js/pomodoro.js
  pomodoro.js          PomodoroTimer model (wall-clock based; survives background tabs)
  alarm.js             synthesized 5s Web Audio alarm tone — no sound asset needed

electron/
  main.js              opens the app window + overlay; tray; battery (pmset); settings
  preload.js           contextBridge: assets, settings, battery, interactivity

src/desktop/           desktop OVERLAY (secondary): transparent click-through pet
  index.html / overlay-desktop.js
  chrome-shim.js       fakes chrome.runtime/chrome.storage so src/content/ runs unchanged

src/options/           Chrome extension options page (character/language)
manifest.json          Chrome extension (MV3, content script on <all_urls>)
overlay.js (in src/content) — extension host overlay

assets/<character>/    pink | owlet | dude — idle, walk, run, jump, hurt, climb, attack1,
                        attack2, death, push, throw, walkattack, dust_jump, dust_run, rock
```

All three hosts reuse `sprite.js` / `pet.js` / `input.js` verbatim; the only extension APIs
those files touch (`chrome.runtime.getURL`, `chrome.storage`) are provided by
[chrome-shim.js](src/desktop/chrome-shim.js) on top of the Electron bridge — one pet engine,
three hosts. `pet.js` takes an optional `getBounds` so the app's Pet Room confines the pet to
the room stage while the overlay/extension default to the full window.

The stat model ([stats.js](src/app/stats.js)), the Pomodoro model
([pomodoro.js](src/app/pomodoro.js)), and the economy model ([economy.js](src/app/economy.js))
are all host-agnostic plain JS (no DOM/chrome/Electron), so their rules are unit-tested
headlessly. Tasks (`tama-tasks` in `localStorage`) are read directly by both `app.js` (the
Pomodoro screen's list) and `room.js` (the right-click reveal) — no shared module between them,
just the same storage key, kept simple since neither needs the other's in-memory state.

The drag-and-drop tray is its own small pointer handler in `room.js`, separate from
[input.js](src/content/input.js)'s pet-drag system (which only handles picking up/throwing the
*pet itself* and is untouched by this). Purchased rooms beyond the original Basic/Game Field are
CSS-gradient themes, not new photos — there's no extra scenery art in the CraftPix pack.

## Assets

Sprites are from a [CraftPix](https://craftpix.net/file-licenses/) pack, normalized into a single
lowercase set per character under `assets/<character>/` (no CamelCase duplicates — the original
pack shipped both the raw sheets and pre-renamed copies of the same 6 base animations; only one
copy of each is kept). **The license permits use but forbids redistributing the assets
themselves** — read it before making this repo public or publishing to the Chrome Web Store.
`PSD/`, `COUPON.*`, and the bundled font are not shipped with the extension.

`assets/coin.png` is a 5-frame, 16×16 coin-spin sheet, animated with a pure-CSS `steps(5)`
sprite-sheet technique — the same approach the character-select screen already used for its
idle-preview animation. Shop item icons and floating feed/play emoji stay emoji-based (🍎🍗🍰🪀🪁)
since no pixel art exists for food/toys in this project.
