const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const APP_ROOT = app.getAppPath();
const DEFAULTS = { language: "ja", character: "pink" };
const CHARACTERS = ["pink", "owlet", "dude"];
const LANGUAGES = [["ja", "日本語"], ["en", "English"], ["ko", "한국어"]];

let win = null;
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
}

// The transparent, click-through desktop overlay (src/desktop/). Kept for a future
// "release to desktop" button — not opened on launch.
function createOverlayWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
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

// --- battery -----------------------------------------------------------------
// Native access is the whole point of going desktop. Level/charging via pmset is
// rock-solid on macOS; true State-of-Health (SoH) is the next step.
function readBattery() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("/usr/bin/pmset", ["-g", "batt"], { timeout: 3000 }, (err, out) => {
      if (err) return resolve(null);
      const level = /(\d+)%/.exec(out);
      const charging = /charg/i.test(out) || (/AC Power/.test(out) && !/discharging/i.test(out));
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
  const menu = Menu.buildFromTemplate([
    {
      label: batt ? `🔋 ${batt.level}%${batt.charging ? " (charging)" : ""}` : "Battery: n/a",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Character",
      submenu: CHARACTERS.map((c) => ({
        label: c, type: "radio", checked: settings.character === c,
        click: () => changeSettings({ character: c }),
      })),
    },
    {
      label: "Language",
      submenu: LANGUAGES.map(([value, label]) => ({
        label, type: "radio", checked: settings.language === value,
        click: () => changeSettings({ language: value }),
      })),
    },
    { type: "separator" },
    { label: "Quit Tamagotchi", role: "quit" },
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
  buildTray();
  setInterval(refreshTray, 60_000);
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
