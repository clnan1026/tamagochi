// Desktop host for the pet. Mirrors src/content/overlay.js, minus the Shadow DOM
// (there is no host page to isolate from) and plus the click-through toggling
// that makes the transparent window pass clicks through everywhere except the pet.
(() => {
  const NS = window.__tamagotchi;

  const SCALE = 2;
  const BUBBLE_MS = 1600;
  const MAX_DT = 0.05; // s; a long stall must not teleport the pet through the floor

  const petEl = document.createElement("div");
  petEl.className = "pet";
  const bubbleEl = document.createElement("div");
  bubbleEl.className = "bubble";
  document.body.append(bubbleEl, petEl);

  let bubbleTimer = null;
  const say = (text) => {
    bubbleEl.textContent = text;
    bubbleEl.classList.add("visible");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove("visible"), BUBBLE_MS);
  };

  chrome.storage.local.get(["language", "character"]).then((result) => {
    const savedLang = result.language || "ja";
    const savedChar = result.character || "pink";

    const sprite = new NS.Sprite(petEl, savedChar, SCALE);
    const pet = new NS.Pet(sprite, { say });
    pet.setLanguage(savedLang);
    NS.attachInput(petEl, pet);

    petEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      window.desktopBridge.openAlarm?.();
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== "local") return;
      if (changes.language) pet.setLanguage(changes.language.newValue);
      if (changes.character) sprite.setCharacter(changes.character.newValue);
    });

    window.desktopBridge.onDisplayChanged(() => {
      pet.onResize();
    });

    // --- click-through toggling ------------------------------------------------
    // The window is click-through by default. We make it interactive only while
    // the cursor is over the pet (or it's being dragged), so clicks on empty
    // space fall through to whatever app is underneath.
    let interactive = false;
    let px = -1, py = -1;
    const overPet = () =>
      px >= pet.x && px <= pet.x + sprite.size && py >= pet.y && py <= pet.y + sprite.size;
    const syncInteractive = () => {
      const want = pet.state === "drag" || overPet();
      if (want !== interactive) {
        interactive = want;
        window.desktopBridge.setInteractive(want);
      }
    };
    // mousemove is forwarded even while click-through; pointermove only fires once
    // interactive, but keeps the position fresh mid-drag.
    window.addEventListener("mousemove", (e) => { px = e.clientX; py = e.clientY; syncInteractive(); });
    window.addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; });

    const positionBubble = () => {
      const x = pet.x + sprite.size / 2;
      const y = pet.y - 6;
      bubbleEl.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    };

    let lastTime = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - lastTime) / 1000, MAX_DT);
      lastTime = now;
      pet.update(dt);
      positionBubble();
      syncInteractive(); // the pet can walk out from under a stationary cursor
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    window.addEventListener("resize", () => pet.onResize());
  });
})();
