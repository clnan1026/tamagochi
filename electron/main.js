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
    width: 420,
    height: 720,
    minWidth: 380,
    minHeight: 600,
    title: "Tamagotchi",
    webPreferences: sharedWebPreferences(),
  });
  win.loadFile(path.join(APP_ROOT, "src/app/index.html"));

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
  const shot = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
  };

  wc.once("did-finish-load", () => {
    setTimeout(async () => {
      const report = {};
      try {
        // Start → Select
        await shot("app-start.png");
        await js(`document.getElementById('start-btn').click()`);
        await wait(300);
        report.selectCards = await js(`document.querySelectorAll('#screen-select .char-card').length`);
        await shot("app-select.png");

        // Seed a hungry, slightly-hurt pet so Feed produces a visible change.
        await js(`localStorage.setItem('tama-stats', JSON.stringify({ hp: 80, satiety: 20, lastSeen: Date.now() }))`);

        // Select owlet → Room
        await js(`document.querySelector('.char-card[data-char="owlet"]').click();
                  document.getElementById('select-confirm').click()`);
        await wait(1500); // stage lays out, pet spawns, first battery poll
        await shot("app-room.png");

        report.beforeBars = await js(`(() => {
          const w = (id) => document.getElementById('fill-' + id).style.width;
          return { hp: w('hp'), sat: w('satiety'), stam: w('stamina'),
                   stamVal: document.getElementById('val-stamina').textContent }; })()`);

        // Feed a few times → Satiety should rise
        await js(`document.getElementById('btn-feed').click()`);
        await wait(120);
        await js(`document.getElementById('btn-feed').click()`);
        await wait(300);
        report.satietyAfterFeed = await js(`document.getElementById('fill-satiety').style.width`);
        report.feedBubble = await js(`document.getElementById('bubble').textContent`);

        // Poke the pet (injected click on the sprite) → hurt + bubble
        const rect = await js(`(() => { const r = document.getElementById('pet').getBoundingClientRect();
          return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
        for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
          wc.sendInputEvent({ type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        }
        await wait(200);
        report.pokeBubble = await js(`({ visible: document.getElementById('bubble').classList.contains('visible'),
          text: document.getElementById('bubble').textContent })`);

        // The rock: present, positioned at the stage's left edge (placeRock(0) on
        // room start), and pointed at the current character's rock.png.
        report.rock = await js(`(() => {
          const r = document.getElementById('rock');
          const cs = getComputedStyle(r);
          return { bg: cs.backgroundImage, transform: cs.transform };
        })()`);

        // Feed once more so eat() (attack1) is exercised distinctly from the
        // earlier hop-era check, then sample mid-animation frames.
        await js(`document.getElementById('btn-feed').click()`);
        report.eatFrames = [];
        for (let i = 0; i < 4; i++) {
          await wait(60);
          report.eatFrames.push(await js(`getComputedStyle(document.getElementById('pet')).backgroundPosition`));
        }

        // Death + revive: re-enter the room with HP already at 0 (the offline-decay
        // dead-on-load path) and confirm the game-over overlay + death pose appear.
        await js(`document.getElementById('room-back').click()`); // → back to Select
        await wait(150);
        await js(`localStorage.setItem('tama-stats', JSON.stringify({ hp: 0, satiety: 0, lastSeen: Date.now() }))`);
        await js(`document.querySelector('.char-card[data-char="pink"]').click();
                  document.getElementById('select-confirm').click()`);
        await wait(400);
        report.gameOverOnLoad = await js(`({
          overlayHidden: document.getElementById('gameover').hidden,
          feedDisabled: document.getElementById('btn-feed').disabled,
          spriteAnim: getComputedStyle(document.getElementById('pet')).backgroundImage.includes('death'),
        })`);
        await shot("app-gameover.png");

        await js(`document.getElementById('btn-revive').click()`);
        await wait(300);
        report.afterRevive = await js(`({
          overlayHidden: document.getElementById('gameover').hidden,
          feedDisabled: document.getElementById('btn-feed').disabled,
          hpWidth: document.getElementById('fill-hp').style.width,
        })`);

        // --- Pomodoro screen: navigate, tabs, task cap, alarm wiring, right-click ---
        await js(`document.getElementById('room-pomodoro').click()`);
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

        // Custom durations: open the editor, set Pomodoro=10min/Break=3min, save,
        // and confirm both the display and the OTHER mode's tab pick it up.
        await js(`document.getElementById('duration-edit-btn').click()`);
        await wait(50);
        report.durationEditorOpen = await js(`!document.getElementById('duration-editor').hidden`);
        await js(`(() => {
          document.getElementById('duration-pomodoro').value = 10;
          document.getElementById('duration-break').value = 3;
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
        const petRect2 = await js(`(() => { const r = document.getElementById('pet').getBoundingClientRect();
          return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
        for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
          wc.sendInputEvent({ type, x: petRect2.x, y: petRect2.y, button: "right", clickCount: 1 });
        }
        await wait(150);
        report.taskTag = await js(`({
          visible: document.getElementById('task-tag').classList.contains('visible'),
          text: document.getElementById('task-tag').textContent,
        })`);
        await shot("app-room-taskreveal.png");

        // --- Field Swiper / Shop stub (merged in from the Lee_Mac branch) ---
        report.swiperBasic = await js(`document.getElementById('swiper-label').textContent`);
        await js(`document.getElementById('swiper-next').click()`);
        await wait(150);
        report.swiperGame = await js(`({
          label: document.getElementById('swiper-label').textContent,
          fieldGameClass: document.getElementById('stage').classList.contains('field-game'),
        })`);
        await shot("app-room-gamefield.png");

        await js(`document.getElementById('swiper-prev').click()`);
        await wait(150);
        report.swiperBackToBasic = await js(
          `!document.getElementById('stage').classList.contains('field-game')`
        );

        // A Shop action button lives inside the *currently active* group only.
        await js(`document.querySelector('.actions-group.active [data-action="shop"]').click()`);
        await wait(150);
        report.shopView = await js(`({
          shopVisible: getComputedStyle(document.getElementById('shop-view')).display !== 'none',
          stageHidden: getComputedStyle(document.getElementById('stage')).display === 'none',
        })`);
        await shot("app-room-shop.png");

        await js(`document.querySelector('.actions-group.active [data-action="field"]').click()`);
        await wait(150);
        report.backFromShop = await js(
          `getComputedStyle(document.getElementById('stage')).display !== 'none'`
        );

        // The "Alarm" action button (not the topbar shortcut) should also reach
        // Pomodoro — this is the real feature now standing in for the old stub.
        await js(`document.querySelector('.actions-group.active [data-action="alarm"]').click()`);
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
      console.log("SMOKE errors:", JSON.stringify(errors));
      app.exit(errors.length ? 1 : 0);
    }, 1500);
  });
}
