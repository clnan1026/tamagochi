// Lets sprite.js / pet.js / input.js / the overlay run byte-for-byte identical to
// the extension by faking the two chrome.* APIs they use, backed by the Electron
// bridge. Everything else in those files is plain DOM and needs no shim.
(() => {
  const bridge = window.desktopBridge;

  window.chrome = {
    runtime: {
      getURL: (p) => bridge.assetURL(p),
    },
    storage: {
      local: {
        get: () => bridge.getSettings(), // returns { language, character }
        set: (obj) => bridge.setSettings(obj),
      },
      onChanged: {
        // Settings changes originate from the tray (main process) and arrive as
        // { key: { newValue } } — the same shape chrome.storage emits.
        addListener: (cb) => bridge.onSettingsChanged((changes) => cb(changes, "local")),
      },
    },
  };
})();
