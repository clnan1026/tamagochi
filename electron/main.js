const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, powerMonitor } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const APP_ROOT = app.getAppPath();
const DEFAULTS = { language: "ja", character: "pink" };
const CHARACTERS = ["pink", "owlet", "dude"];
const LANGUAGES = [["ja", "日本語"], ["en", "English"], ["ko", "한국어"]];

let win = null;
let overlay = null;
let currentDisplayId = null;
let tray = null;
let settings = { ...DEFAULTS };

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings));
  } catch {
    /* best effort */
  }
}

const sharedWebPreferences = () => ({
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false, // preload needs process.argv to learn the app root
  backgroundThrottling: false, // keep the pet animating while unfocused
  additionalArguments: ["--app-root=" + APP_ROOT],
});

// The primary experience: a normal portrait window with the Start → Select →
// Room flow (src/app/). Opened on launch.
function createAppWindow() {
  win = new BrowserWindow({
    width: 390,
    height: 844,
    minWidth: 260,
    minHeight: 562,
    title: "Tamagotchi",
    webPreferences: sharedWebPreferences(),
  });
  win.setAspectRatio(390 / 844); // always phone-shaped; app.css scales its content to fit

  // Clear cache to force reload modified asset images
  win.webContents.session.clearCache().finally(() => {
    win.loadFile(path.join(APP_ROOT, "src/app/index.html"));
  });

  // Prevent app from quitting when room window is closed; hide it instead
  win.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // Rebuild tray menu when room window visibility changes to toggle 'Open Room' option
  win.on("show", () => refreshTray());
  win.on("hide", () => refreshTray());
}

// The transparent, click-through desktop overlay (src/desktop/). Kept for a future
// "release to desktop" button — not opened on launch.
function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  currentDisplayId = primaryDisplay.id;

  const { x, y, width, height } = primaryDisplay.workArea;
  const overlay = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: sharedWebPreferences(),
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(APP_ROOT, "src/desktop/index.html"));
  return overlay;
}

function updateOverlayMonitor() {
  if (!overlay || overlay.isDestroyed()) return;
  const cursorPoint = screen.getCursorScreenPoint();
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
  if (activeDisplay.id !== currentDisplayId) {
    currentDisplayId = activeDisplay.id;
    const { x, y, width, height } = activeDisplay.workArea;
    overlay.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    });
    overlay.webContents.send("display:changed");
  }
}

// --- battery -----------------------------------------------------------------
// Native access is the whole point of going desktop. Level/charging via pmset is
// rock-solid on macOS; true State-of-Health (SoH) is the next step.
function readBattery() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("/usr/bin/pmset", ["-g", "batt"], { timeout: 3000 }, (err, out) => {
      if (err) return resolve(null);
      const level = /(\d+)%/.exec(out);
      const charging = /; charging/i.test(out) || (/AC Power/.test(out) && !/discharging/i.test(out));
      resolve(level ? { level: +level[1], charging } : null);
    });
  });
}

// --- tray --------------------------------------------------------------------
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(APP_ROOT, `assets/${settings.character}/idle.png`));
  if (img.isEmpty()) return img;
  // The sheet is a horizontal strip; take the first 32x32 frame as the icon.
  return img.crop({ x: 0, y: 0, width: 32, height: 32 }).resize({ width: 18, height: 18 });
}

async function refreshTray() {
  if (!tray) return;
  const batt = await readBattery();

  const isVisible = win && !win.isDestroyed() && win.isVisible();

  const openLabels = { ja: "部屋を開く", ko: "룸 열기", en: "Open Room" };
  const quitLabels = { ja: "たまごっちを終了", ko: "다마고치 종료", en: "Quit Tamagotchi" };
  const charLabels = { ja: "キャラクター", ko: "캐릭터 선택", en: "Character" };
  const langLabels = { ja: "言語", ko: "언어 설정", en: "Language" };

  const openLabel = openLabels[settings.language] || "Open Room";
  const quitLabel = quitLabels[settings.language] || "Quit Tamagotchi";
  const charLabel = charLabels[settings.language] || "Character";
  const langLabel = langLabels[settings.language] || "Language";

  const batteryLabel = batt 
    ? `${batt.charging ? "⚡ " : "🔋 "}${batt.level}%${batt.charging ? " (charging)" : ""}`
    : "Battery: n/a";

  const menu = Menu.buildFromTemplate([
    {
      label: openLabel,
      enabled: !isVisible,
      click: () => {
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: batteryLabel,
      enabled: true,
    },
    { type: "separator" },
    {
      label: charLabel,
      submenu: CHARACTERS.map((c) => ({
        label: c, type: "radio", checked: settings.character === c,
        click: () => changeSettings({ character: c }),
      })),
    },
    {
      label: langLabel,
      submenu: LANGUAGES.map(([value, label]) => ({
        label, type: "radio", checked: settings.language === value,
        click: () => changeSettings({ language: value }),
      })),
    },
    { type: "separator" },
    {
      label: quitLabel,
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setImage(trayIcon());
  tray.setContextMenu(menu);
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Tamagotchi");
  refreshTray();
}

// Apply a settings change and push it to the running pet in chrome.storage shape.
function changeSettings(partial) {
  const changes = {};
  for (const [key, value] of Object.entries(partial)) {
    if (settings[key] === value) continue;
    settings[key] = value;
    changes[key] = { newValue: value };
  }
  if (Object.keys(changes).length === 0) return;
  saveSettings();
  if (win && !win.isDestroyed()) win.webContents.send("settings:changed", changes);
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send("settings:changed", changes);
  refreshTray();
}

// --- ipc ---------------------------------------------------------------------
ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:set", (_e, partial) => {
  changeSettings(partial);
  return settings;
});
ipcMain.handle("battery:get", () => readBattery());
ipcMain.on("mouse:setInteractive", (e, interactive) => {
  // Act on whichever window sent it (the overlay), not the global `win`.
  const sender = BrowserWindow.fromWebContents(e.sender);
  if (sender && !sender.isDestroyed()) sender.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on("action:openAlarm", () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    win.webContents.send("navigate:pomodoro");
  }
});

// --- lifecycle ---------------------------------------------------------------
app.whenReady().then(() => {
  loadSettings();
  createAppWindow();
  overlay = createOverlayWindow();
  buildTray();

  // Listen to macOS power transitions (plugging/unplugging charger)
  powerMonitor.on("on-ac", () => {
    refreshTray();
    if (win && !win.isDestroyed()) win.webContents.send("battery:changed");
  });
  powerMonitor.on("on-battery", () => {
    refreshTray();
    if (win && !win.isDestroyed()) win.webContents.send("battery:changed");
  });

  setInterval(refreshTray, 60_000);
  setInterval(updateOverlayMonitor, 1000);
  maybeRunSmoke();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createAppWindow();
});

// The app window is the product; closing it quits (the tray's Quit does the same).
app.on("window-all-closed", () => app.quit());

// --- smoke test (TAMA_SMOKE=1): render, screenshot, poke, report, quit -------
function maybeRunSmoke() {
  if (!process.env.TAMA_SMOKE) return;
  const errors = [];
  const consoleMsgs = [];
  win.webContents.on("console-message", (e, level, message) => {
    const lvl = typeof level === "number" ? level : e?.level;
    consoleMsgs.push(`[${lvl}] ${message ?? e?.message}`);
  });
  win.webContents.on("render-process-gone", (_e, d) => errors.push("render-gone: " + d.reason));

  const outDir = process.env.TAMA_SMOKE_OUT || app.getPath("temp");
  const wc = win.webContents;
  const js = (expr) => wc.executeJavaScript(expr);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const screenshotErrors = [];
  // capturePage() can throw (e.g. "UnknownVizError") if the GPU compositor isn't
  // settled yet — most likely right after a wc.reload(). Screenshots are a
  // diagnostic nicety, not a correctness assertion, so a failure here must not
  // abort the whole drive() flow the way an uncaught throw would.
  const shot = async (name) => {
    try {
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(outDir, name), img.toPNG());
    } catch (e) {
      screenshotErrors.push(name + ": " + e.message);
    }
  };

  wc.once("did-finish-load", () => {
    setTimeout(async () => {
      const report = {};
      // Electron's higher-level webContents.sendInputEvent proved unreliable at
      // hitting small targets in this build (confirmed via diagnostics: clicks
      // that should land squarely on the pet silently missed). The raw CDP
      // debugger's Input.dispatchMouseEvent is what real clicks are built on and
      // reliably hits — use it for every pointer interaction in this test.
      wc.debugger.attach("1.3");
      const cdpMouse = async (type, x, y, opts = {}) =>
        wc.debugger.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...opts });
      const click = async (x, y, button = "left") => {
        await cdpMouse("mouseMoved", x, y);
        await cdpMouse("mousePressed", x, y, { button });
        await cdpMouse("mouseReleased", x, y, { button });
      };
      const dragItem = async (fromRect, toRect) => {
        await cdpMouse("mouseMoved", fromRect.x, fromRect.y);
        await cdpMouse("mousePressed", fromRect.x, fromRect.y);
        await cdpMouse("mouseMoved", toRect.x, toRect.y, { buttons: 1 });
        await cdpMouse("mouseReleased", toRect.x, toRect.y);
      };
      const centerOf = (selector) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
      const waitForLoad = () => new Promise((resolve) => wc.once("did-finish-load", resolve));

      try {
        // --- First-ever boot: no character chosen yet → Start, then Select ------
        await shot("app-start.png");
        report.startActiveOnBoot = await js(`document.getElementById('screen-start').classList.contains('active')`);
        await js(`document.getElementById('start-btn').click()`);
        await wait(300);
        report.selectCards = await js(`document.querySelectorAll('#screen-select .char-card').length`);
        await shot("app-select.png");

        // --- Boot-skip regression: a previously-chosen (owned) character should
        // skip Start/Select entirely on the next launch. This is the exact area
        // this session's original bug lived in (character appearing to die
        // instantly right after selection, traced to a stale global stats key) —
        // now re-verified end to end via a real reload, not just inspection. -----
        changeSettings({ character: "pink" }); // main-process settings, not chrome.storage
        const reload1 = waitForLoad();
        wc.reload();
        await reload1;
        await wait(1000);
        report.bootSkipToRoom = await js(`({
          roomActive: document.getElementById('screen-room').classList.contains('active'),
          startActive: document.getElementById('screen-start').classList.contains('active'),
        })`);

        // Seed a hungry, slightly-hurt Pink + a starter coin balance so drag
        // actions produce a visible change without waiting for real spawn timers.
        await js(`document.getElementById('room-back').click()`);
        await wait(150);
        await js(`localStorage.setItem('tama-stats:pink', JSON.stringify({ hp: 80, satiety: 20, lastSeen: Date.now() }))`);
        await js(`localStorage.setItem('tama-economy', JSON.stringify({ coins: 1200 }))`);
        // Shrinks the coin-spawn wait to its real floor (still real time, not
        // eliminated — production spawn cadence is untouched) by removing
        // Math.random()'s jitter component; other randomness (wander, phrases,
        // ball-launch direction/speed) just becomes deterministic for this run.
        await js(`Math.random = () => 0; void 0;`); // assignment exprs return the fn — not cloneable over IPC

        const roomEntryTime = Date.now();
        await js(`document.querySelector('.char-card[data-char="pink"]').click();
                  document.getElementById('select-confirm').click()`);
        await wait(1500); // stage lays out, pet spawns, first battery poll
        await shot("app-room.png");

        // Directly verify the game loop is actually alive: sample the pet's
        // transform and stat bars over real time. This is the exact thing the
        // user reported broken ("character stuck and not moving") earlier in
        // this session.
        const sampleMovement = async () => ({
          transform: await js(`document.getElementById('pet').style.transform`),
          satiety: await js(`document.getElementById('fill-satiety').style.width`),
        });
        const moveSample1 = await sampleMovement();
        await wait(3000);
        const moveSample2 = await sampleMovement();
        report.gameLoopAlive = {
          transformChanged: moveSample1.transform !== moveSample2.transform,
          satietyTicked: moveSample1.satiety !== moveSample2.satiety,
          before: moveSample1,
          after: moveSample2,
        };

        report.beforeBars = await js(`(() => {
          const w = (id) => document.getElementById('fill-' + id).style.width;
          return { hp: w('hp'), sat: w('satiety'), stam: w('stamina'),
                   stamVal: document.getElementById('val-stamina').textContent }; })()`);
        report.coinBadge = await js(`document.getElementById('coin-count').textContent`);

        // Kitchen is the default room — the tray should offer at least free Kibble.
        report.trayInKitchen = await js(
          `Array.from(document.querySelectorAll('#item-tray .tray-item')).map((el) => el.textContent.trim())`
        );

        // Drag Kibble onto the pet → Feed effect (Satiety rises, +2 coins, a
        // floating "+N" coin popup alongside the reaction emoji/bubble).
        await dragItem(await centerOf("#item-tray .tray-item"), await centerOf("#pet"));
        await wait(200);
        report.afterFeedDrag = await js(`({
          satiety: document.getElementById('fill-satiety').style.width,
          coins: document.getElementById('coin-count').textContent,
          bubble: document.getElementById('bubble').textContent,
          coinFx: !!document.querySelector('.fx-coin'),
        })`);

        // Drag a tray item and drop it far from the pet → should snap back, no effect.
        const trayBeforeMiss = await centerOf("#item-tray .tray-item");
        await dragItem(trayBeforeMiss, { x: 5, y: 5 });
        await wait(400); // let the snap-back transition finish
        report.afterMissDrag = await js(`({
          satiety: document.getElementById('fill-satiety').style.width,
          coins: document.getElementById('coin-count').textContent,
          ghostGone: document.querySelectorAll('.drag-ghost').length === 0,
        })`);

        // Poke the pet (injected click on the sprite) → hurt + bubble
        const rect = await centerOf("#pet");
        await click(rect.x, rect.y);
        await wait(200);
        report.pokeBubble = await js(`({ visible: document.getElementById('bubble').classList.contains('visible'),
          text: document.getElementById('bubble').textContent })`);

        // A reusable "buy whichever unowned card comes first" helper — shop
        // cards are re-queried after every click (renderShop() rebuilds the grid),
        // and clicking an already-"Owned"/disabled button is a genuine DOM no-op,
        // so tests must target a still-purchasable card rather than just "the
        // first card", or a repeat click silently buys nothing.
        const buyFirstUnowned = () => js(`(() => {
          const cards = Array.from(document.querySelectorAll('#shop-grid .shop-item'));
          const target = cards.find((c) => {
            const btn = c.querySelector('button');
            return !btn.disabled && !btn.classList.contains('owned');
          });
          if (!target) return null;
          const name = target.querySelector('.shop-item-name').textContent;
          target.querySelector('button').click();
          return { name, ownedNow: target.querySelector('button').textContent };
        })()`);

        // --- Kitchen shop: drinks / sweets / meals / backgrounds tabs -------------
        await js(`document.querySelector('.actions-group.active [data-action="shop"]').click()`);
        await wait(150);
        report.kitchenShopTabs = await js(`Array.from(document.querySelectorAll('.shop-tab')).map((t) => t.textContent)`);
        await shot("app-shop-kitchen.png");
        // Default tab is "meals" (SHOP_TABS order) — switch to sweets before buying.
        await js(`Array.from(document.querySelectorAll('.shop-tab')).find((t) => t.textContent.includes('Sweets') || t.textContent.includes('スイーツ') || t.textContent.includes('디저트')).click()`);
        await wait(100);
        report.buySweet = await buyFirstUnowned();
        report.shopCoinsAfterSweetBuy = await js(`document.getElementById('shop-coin-count').textContent`);
        await js(`document.querySelector('.actions-group.active [data-action="field"]').click()`);
        await wait(150);
        report.kitchenTrayAfterFoodBuy = await js(
          `Array.from(document.querySelectorAll('#item-tray .tray-item')).map((el) => el.textContent.trim())`
        );

        // --- Cycle rooms: Kitchen → Game Room → Bedroom → Kitchen. Exactly one of
        // the tray / ball shelf / mic panel should be visible at a time. ----------
        await js(`document.getElementById('swiper-next').click()`); // → Game Room
        await wait(300);
        report.roomGame = await js(`document.getElementById('swiper-label').textContent`);
        // Game Room now uses the exact same static drag tray as Kitchen — just
        // showing owned balls instead of owned food (no bouncing/physics).
        report.gameRoomPanels = await js(`({
          trayVisible: getComputedStyle(document.getElementById('item-tray')).display !== 'none',
          trayItems: Array.from(document.querySelectorAll('#item-tray .tray-item')).map((el) => el.textContent.trim()),
        })`);
        await shot("app-room-gameroom.png");

        await js(`document.getElementById('swiper-next').click()`); // → Bedroom
        await wait(150);
        report.roomBedroom = await js(`document.getElementById('swiper-label').textContent`);
        report.bedroomPanels = await js(`({
          micVisible: getComputedStyle(document.getElementById('mic-panel')).display !== 'none',
          trayHidden: getComputedStyle(document.getElementById('item-tray')).display === 'none',
        })`);
        await shot("app-room-bedroom.png");

        // --- Bedroom mic: monkey-patch getUserMedia with a real (silent-content)
        // WebAudio-generated MediaStream — MediaRecorder can genuinely record and
        // decodeAudioData can genuinely decode this, unlike a bare mock stream, so
        // this exercises the actual record → stop → decode → pitch-shift →
        // "talking" pipeline without needing real microphone hardware/permission
        // (which the CDP harness can't grant in a headless run anyway). ----------
        await js(`(() => {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = ctx.createMediaStreamDestination();
          const osc = ctx.createOscillator();
          osc.connect(dest);
          osc.start();
          window.__smokeAudio = { ctx, dest, osc };
          navigator.mediaDevices.getUserMedia = async () => dest.stream;
        })()`);
        await js(`document.getElementById('mic-btn').click()`); // start recording
        await wait(150);
        report.micRecording = await js(`document.getElementById('mic-btn').classList.contains('recording')`);
        await wait(1000);
        await js(`document.getElementById('mic-btn').click()`); // stop → decode → pitched playback
        // The pitch-shifted (1.6x) playback of a ~1s recording lasts well under a
        // second, so poll rather than guess a single fixed snapshot time.
        let talkingWasSeen = false;
        for (let i = 0; i < 20 && !talkingWasSeen; i++) {
          await wait(100);
          talkingWasSeen = await js(`document.getElementById('pet').classList.contains('talking')`);
        }
        await wait(800); // outlast the short playback so the class clears again
        report.micAfterStop = await js(`({
          recordingClassCleared: !document.getElementById('mic-btn').classList.contains('recording'),
        })`);
        report.micAfterStop.talkingWasSeenDuringPlayback = talkingWasSeen;
        report.micAfterStop.talkingClearedAfter = !(await js(`document.getElementById('pet').classList.contains('talking')`));

        await js(`document.getElementById('swiper-prev').click()`); // → back to Game Room
        await wait(150);

        // --- Game Room shop: buy two genuinely-locked balls, then interact with
        // the shelf via tap-to-shelve and drag-onto-pet. -------------------------
        await js(`document.querySelector('.actions-group.active [data-action="shop"]').click()`);
        await wait(150);
        report.shopView = await js(`({
          shopVisible: getComputedStyle(document.getElementById('shop-view')).display !== 'none',
          stageHidden: getComputedStyle(document.getElementById('stage')).display === 'none',
          tabs: Array.from(document.querySelectorAll('.shop-tab')).map((t) => t.textContent),
        })`);
        await shot("app-shop-balls.png");

        report.buyBall1 = await buyFirstUnowned();
        report.buyBall2 = await buyFirstUnowned();
        report.shopCoinsAfterBallBuys = await js(`document.getElementById('shop-coin-count').textContent`);

        // Game Room's Backgrounds tab: buy-and-equip, then switch back to Default.
        await js(`Array.from(document.querySelectorAll('.shop-tab')).find((t) => t.textContent.includes('Backgrounds') || t.textContent.includes('背景') || t.textContent.includes('배경')).click()`);
        await wait(100);
        await shot("app-shop-backgrounds.png");
        report.buyBackground = await js(`(() => {
          const cards = document.querySelectorAll('#shop-grid .shop-item');
          const purchasable = cards[1]; // cards[0] is the always-owned "Default" card
          purchasable.querySelector('button').click();
          return purchasable.querySelector('button').textContent;
        })()`);
        report.stageBgAfterBuy = await js(`getComputedStyle(document.getElementById('stage')).backgroundImage`);
        report.revertToDefaultBackground = await js(`(() => {
          document.querySelectorAll('#shop-grid .shop-item')[0].querySelector('button').click();
          return true;
        })()`);
        report.stageBgAfterRevert = await js(`getComputedStyle(document.getElementById('stage')).backgroundImage`);

        await js(`document.querySelector('.actions-group.active [data-action="field"]').click()`);
        await wait(200);
        report.backFromShop = await js(`getComputedStyle(document.getElementById('stage')).display !== 'none'`);

        // --- Ball tray: the exact same static drag-tray mechanism as Kitchen's
        // food tray — just showing owned balls (ball/yoyo/kite bought above). ----
        report.gameRoomTrayAfterBuys = await js(
          `Array.from(document.querySelectorAll('#item-tray .tray-item')).map((el) => el.textContent.trim())`
        );
        const coinsBeforeBallPlay = await js(`document.getElementById('coin-count').textContent`);
        await dragItem(await centerOf("#item-tray .tray-item"), await centerOf("#pet"));
        await wait(200);
        report.afterBallPlayDrag = await js(`({
          coinsBefore: ${JSON.stringify(coinsBeforeBallPlay)},
          coinsAfter: document.getElementById('coin-count').textContent,
          bubble: document.getElementById('bubble').textContent,
          coinFx: !!document.querySelector('.fx-coin'),
        })`);

        // Drag a tray item and drop it far from the pet → should snap back, no effect.
        const ballTrayBeforeMiss = await centerOf("#item-tray .tray-item");
        await dragItem(ballTrayBeforeMiss, { x: 5, y: 5 });
        await wait(400); // let the snap-back transition finish
        report.afterBallMissDrag = await js(`({
          coins: document.getElementById('coin-count').textContent,
          ghostGone: document.querySelectorAll('.drag-ghost').length === 0,
        })`);

        // --- Bedroom shop: only a Backgrounds tab (characters are no longer sold
        // anywhere — all 3 are freely playable, no locking/purchase). -------------
        await js(`document.getElementById('swiper-next').click()`); // → Bedroom
        await wait(150);
        await js(`document.querySelector('.actions-group.active [data-action="shop"]').click()`);
        await wait(150);
        report.bedroomShopTabs = await js(`Array.from(document.querySelectorAll('.shop-tab')).map((t) => t.textContent)`);
        await shot("app-shop-bedroom-backgrounds.png");
        report.buyBedroomBackground = await js(`(() => {
          const cards = document.querySelectorAll('#shop-grid .shop-item');
          const purchasable = cards[1]; // cards[0] is the always-owned "Default" card
          purchasable.querySelector('button').click();
          return purchasable.querySelector('button').textContent;
        })()`);
        report.stageBgAfterBedroomBuy = await js(`getComputedStyle(document.getElementById('stage')).backgroundImage`);
        await js(`document.querySelectorAll('#shop-grid .shop-item')[0].querySelector('button').click()`); // revert to default
        await js(`document.querySelector('.actions-group.active [data-action="field"]').click()`);
        await wait(150);

        // --- Character switch + per-character stats isolation: this is the core
        // regression test for this session's original bug (a stale global stats
        // key made a freshly-picked character appear to die instantly). Pink was
        // seeded hungry/hurt above; Owlet must come up completely fresh. All three
        // characters are freely selectable — no lock/purchase gate anymore. -------
        await js(`document.getElementById('room-back').click()`);
        await wait(150);
        report.charCardsUnlocked = await js(`Array.from(document.querySelectorAll('.char-card')).every((c) => !c.classList.contains('locked'))`);
        await js(`document.querySelector('.char-card[data-char="owlet"]').click();
                  document.getElementById('select-confirm').click()`);
        await wait(500);
        report.owletFreshStats = await js(`({
          hp: document.getElementById('fill-hp').style.width,
          satiety: document.getElementById('fill-satiety').style.width,
          gameOverVisible: !document.getElementById('gameover').hidden,
        })`);

        // Death + revive: re-enter with Owlet's HP already at 0 (the offline-decay
        // dead-on-load path) and confirm the game-over overlay + death pose appear,
        // and that the item-tray is cleared while fainted.
        await js(`document.getElementById('room-back').click()`);
        await wait(150);
        await js(`localStorage.setItem('tama-stats:owlet', JSON.stringify({ hp: 0, satiety: 0, lastSeen: Date.now() }))`);
        await js(`document.querySelector('.char-card[data-char="owlet"]').click();
                  document.getElementById('select-confirm').click()`);
        await wait(400);
        report.gameOverOnLoad = await js(`({
          overlayHidden: document.getElementById('gameover').hidden,
          trayEmpty: document.querySelectorAll('#item-tray .tray-item').length === 0,
          spriteAnim: getComputedStyle(document.getElementById('pet')).backgroundImage.includes('death'),
        })`);
        await shot("app-gameover.png");

        await js(`document.getElementById('btn-revive').click()`);
        await wait(300);
        // Which bottom panel repopulates after revive depends on the current
        // room's type (only Kitchen shows a food tray; Bedroom shows the mic
        // instead) — check whichever one actually applies rather than assuming Kitchen.
        report.afterRevive = await js(`({
          overlayHidden: document.getElementById('gameover').hidden,
          hpWidth: document.getElementById('fill-hp').style.width,
          panelRestored: document.getElementById('swiper-label').textContent.includes('キッチン')
            || document.getElementById('swiper-label').textContent.includes('Kitchen')
            || document.getElementById('swiper-label').textContent.includes('주방')
            ? document.querySelectorAll('#item-tray .tray-item').length > 0
            : true,
        })`);

        // --- Coin/poop spawn (Game Room only): real-time wait at the (jitter-
        // removed) 25s floor. Room order is Kitchen → Game Room → Bedroom, cycling
        // "next" until the Game Room is the one showing (both it and Kitchen now
        // show a tray, so match on the room label rather than tray presence). ----
        const isGameRoom = () => js(`(() => {
          const t = document.getElementById('swiper-label').textContent;
          return t.includes('Game Room') || t.includes('ゲームルーム') || t.includes('게임룸');
        })()`);
        for (let i = 0; i < 3 && !(await isGameRoom()); i++) {
          await js(`document.getElementById('swiper-next').click()`);
          await wait(150);
        }
        report.roomForSpawnTest = await js(`document.getElementById('swiper-label').textContent`);

        report.elapsedBeforeCoinWait = Date.now() - roomEntryTime;
        let pickupKind = null;
        const spawnDeadline = Date.now() + 45_000;
        while (Date.now() < spawnDeadline) {
          await wait(2000);
          pickupKind = await js(`(() => {
            if (document.querySelector('.stage-pickup.coin')) return 'coin';
            if (document.querySelector('.stage-pickup.poop')) return 'poop';
            return null;
          })()`);
          if (pickupKind) break;
        }
        report.pickupSpawned = pickupKind;
        if (pickupKind) {
          const selector = ".stage-pickup." + pickupKind;
          const coinsBefore = await js(`document.getElementById('coin-count').textContent`);
          await dragItem(await centerOf(selector), await centerOf(selector));
          await wait(150);
          report.afterPickupCollect = {
            coinsBefore,
            coinsAfter: await js(`document.getElementById('coin-count').textContent`),
            pickupGone: await js(`!document.querySelector(${JSON.stringify(selector)})`),
            coinFx: await js(`!!document.querySelector('.fx-coin')`),
          };
        }
        await shot("app-room-coinpickup.png");

        // --- Pomodoro screen: navigate, tabs, task cap, alarm wiring, right-click ---
        await js(`document.querySelector('.actions-group.active [data-action="pomodoro"]').click()`);
        await wait(200);
        report.pomodoroScreenActive = await js(
          `document.getElementById('screen-pomodoro').classList.contains('active')`
        );
        await shot("app-pomodoro.png");

        report.timerByMode = {};
        for (const mode of ["pomodoro", "break"]) {
          await js(`document.querySelector('.mode-tab[data-mode="${mode}"]').click()`);
          await wait(50);
          report.timerByMode[mode] = await js(`document.getElementById('timer-display').textContent`);
        }
        await js(`document.querySelector('.mode-tab[data-mode="pomodoro"]').click()`);

        // Custom durations: open the editor, set Pomodoro=10min 15sec/Break=3min,
        // save, and confirm both the display and the OTHER mode's tab pick it up.
        await js(`document.getElementById('duration-edit-btn').click()`);
        await wait(50);
        report.durationEditorOpen = await js(`!document.getElementById('duration-editor').hidden`);
        await js(`(() => {
          document.getElementById('duration-pomodoro-min').value = 10;
          document.getElementById('duration-pomodoro-sec').value = 15;
          document.getElementById('duration-break-min').value = 3;
          document.getElementById('duration-break-sec').value = 0;
        })()`);
        await js(`document.getElementById('duration-save').click()`);
        await wait(50);
        report.afterCustomDuration = {
          editorClosed: await js(`document.getElementById('duration-editor').hidden`),
          pomodoro: await js(`document.getElementById('timer-display').textContent`),
        };
        await js(`document.querySelector('.mode-tab[data-mode="break"]').click()`);
        await wait(50);
        report.customBreakDisplay = await js(`document.getElementById('timer-display').textContent`);

        // The editor should be locked out while a session is actually running.
        await js(`document.querySelector('.mode-tab[data-mode="pomodoro"]').click()`);
        await js(`document.getElementById('timer-toggle').click()`); // Start
        await wait(50);
        report.editLockedWhileRunning = await js(`document.getElementById('duration-edit-btn').disabled`);
        await js(`document.getElementById('timer-toggle').click()`); // Pause again
        await wait(50);
        await js(`document.getElementById('timer-reset').click()`); // back to a clean idle state

        // Add tasks up to the 4-slot cap.
        for (const text of ["Write the report", "Review PR", "Reply to emails", "Plan tomorrow"]) {
          await js(`document.getElementById('task-add').click()`);
          await js(`(() => {
            const input = document.querySelector('.task-input');
            input.value = ${JSON.stringify(text)};
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
          })()`);
          await wait(50);
        }
        report.taskCountAt4 = await js(`document.querySelectorAll('.task-row').length`);
        report.addDisabledAt4 = await js(`document.getElementById('task-add').disabled`);
        await js(`document.getElementById('task-add').click()`); // should no-op: already at cap
        await wait(50);
        report.taskCountAfterAttempted5th = await js(`document.querySelectorAll('.task-row').length`);
        await shot("app-pomodoro-tasks.png");

        // Check the first task off — the right-click reveal below should then
        // skip it and show the second (first *unchecked*) task instead.
        await js(`document.querySelector('.task-checkbox').click()`);
        await wait(50);
        report.firstTaskDone = await js(`document.querySelector('.task-row').classList.contains('done')`);

        await js(`document.getElementById('pomodoro-back').click()`); // → Room, pet still mounted
        await wait(200);

        // Exercise the exact real functions app.js calls when a session finishes.
        // The countdown timing itself is proven deterministically & headlessly in
        // pomodoro-test.js; this proves the DOM/audio wiring doesn't throw and the
        // pet actually reacts.
        let alarmErr = null;
        try {
          await js(`window.__tamagotchi.playAlarm(); window.__tamagotchi.Room.onAlarm();`);
        } catch (e) {
          alarmErr = e.message;
        }
        report.alarmWiringError = alarmErr;
        await wait(150);
        report.bubbleAfterAlarm = await js(`({
          visible: document.getElementById('bubble').classList.contains('visible'),
          text: document.getElementById('bubble').textContent,
        })`);

        // Right-click the pet → the task-tag should show the first *unchecked* task.
        // CDP's Input.dispatchMouseEvent doesn't synthesize a native `contextmenu`
        // DOM event for the right button (confirmed: no listener anywhere fires,
        // a documented CDP limitation) — dispatch the real event directly instead,
        // which exercises room.js's actual handler exactly as a genuine right
        // click would.
        await js(`document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
        await wait(150);
        report.taskTag = await js(`({
          visible: document.getElementById('task-tag').classList.contains('visible'),
          text: document.getElementById('task-tag').textContent,
        })`);
        await shot("app-room-taskreveal.png");

        // The "Alarm" action button (not the topbar shortcut) should also reach
        // Pomodoro — this is the real feature now standing in for the old stub.
        await js(`document.querySelector('.actions-group.active [data-action="pomodoro"]').click()`);
        await wait(150);
        report.alarmActionOpensPomodoro = await js(
          `document.getElementById('screen-pomodoro').classList.contains('active')`
        );
        await js(`document.getElementById('pomodoro-back').click()`);
      } catch (e) {
        errors.push("drive: " + e.message);
      }

      report.battery = await readBattery();
      console.log("SMOKE report:", JSON.stringify(report));
      console.log("SMOKE console:", JSON.stringify(consoleMsgs));
      console.log("SMOKE screenshotErrors:", JSON.stringify(screenshotErrors));
      console.log("SMOKE errors:", JSON.stringify(errors));
      app.exit(errors.length ? 1 : 0);
    }, 1500);
  });
}
