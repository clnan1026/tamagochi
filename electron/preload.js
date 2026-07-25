const { contextBridge, ipcRenderer } = require("electron");

// The app root is passed as a launch argument (see main.js additionalArguments),
// so the renderer can build file:// URLs for the sprite sheets synchronously.
const rootArg = process.argv.find((a) => a.startsWith("--app-root=")) || "";
const APP_ROOT = rootArg.slice("--app-root=".length);

contextBridge.exposeInMainWorld("desktopBridge", {
  assetURL: (p) => "file://" + encodeURI(APP_ROOT + "/" + p),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (partial) => ipcRenderer.invoke("settings:set", partial),
  onSettingsChanged: (cb) => ipcRenderer.on("settings:changed", (_e, changes) => cb(changes)),
  setInteractive: (interactive) => ipcRenderer.send("mouse:setInteractive", interactive),
  getBattery: () => ipcRenderer.invoke("battery:get"),
  onBatteryChanged: (cb) => ipcRenderer.on("battery:changed", () => cb()),
});
