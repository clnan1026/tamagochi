const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const APP_ROOT = app.getAppPath();
const DEFAULTS = { language: "ja", character: "pink" };
const CHARACTERS = ["pink", "owlet", "dude", "shinchan"];
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

function createWindow() {
  // Cover the primary display's work area (excludes the menu bar/dock), so the
  // pet walks along the real desktop floor and never hides under the dock.
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
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
    focusable: false, // never steal focus from the app the user is actually using
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs process.argv to learn the app root
      backgroundThrottling: false, // keep animating while unfocused (it always is)
      additionalArguments: ["--app-root=" + APP_ROOT],
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Start fully click-through; the renderer flips this on when the cursor is
  // over the pet. `forward` keeps mousemove flowing so hover detection works.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(APP_ROOT, "src/desktop/index.html"));
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
ipcMain.on("mouse:setInteractive", (_e, interactive) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true });
});

// --- lifecycle ---------------------------------------------------------------
app.whenReady().then(() => {
  loadSettings();
  if (process.platform === "darwin" && app.dock) app.dock.hide(); // background agent, no dock icon
  createWindow();
  buildTray();
  setInterval(refreshTray, 60_000);
  maybeRunSmoke();
});

// Tray app: keep running even though the window is never "closed".
app.on("window-all-closed", () => {});

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

  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      const outDir = process.env.TAMA_SMOKE_OUT || app.getPath("temp");
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, "desktop-pet.png"), img.toPNG());
      } catch (e) {
        errors.push("capture: " + e.message);
      }

      // Drive a poke through the real renderer (injected events bypass OS click-through).
      let poke = null;
      try {
        const rect = await win.webContents.executeJavaScript(
          `(() => { const p = document.querySelector('.pet'); const r = p.getBoundingClientRect();
             return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`
        );
        for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
          win.webContents.sendInputEvent({ type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        }
        await new Promise((r) => setTimeout(r, 200));
        poke = await win.webContents.executeJavaScript(
          `(() => { const b = document.querySelector('.bubble');
             return { visible: b.classList.contains('visible'), text: b.textContent }; })()`
        );
      } catch (e) {
        errors.push("poke: " + e.message);
      }

      const batt = await readBattery();
      console.log("SMOKE screenshot:", path.join(outDir, "desktop-pet.png"));
      console.log("SMOKE battery:", JSON.stringify(batt));
      console.log("SMOKE poke:", JSON.stringify(poke));
      console.log("SMOKE console:", JSON.stringify(consoleMsgs));
      console.log("SMOKE errors:", JSON.stringify(errors));
      app.exit(errors.length ? 1 : 0);
    }, 3000);
  });
}
