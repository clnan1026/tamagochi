(() => {
  const NS = (window.__tamagotchi ??= {});

  if (NS.mounted) return;
  if (window.top !== window) return; // top frame only
  // Chrome injects into plain-text and XML documents too; there is no page to stand on.
  if (!document.documentElement || !document.contentType?.includes("html")) return;

  NS.mounted = true;

  const SCALE = 2;
  const CHARACTER = "pink";
  const BUBBLE_MS = 1600;
  const MAX_DT = 0.05; // s; a long tab-switch must not teleport the pet through the floor

  const STYLES = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
    }
    .pet {
      position: fixed;
      top: 0;
      left: 0;
      width: ${NS.FRAME_SIZE * SCALE}px;
      height: ${NS.FRAME_SIZE * SCALE}px;
      background-repeat: no-repeat;
      image-rendering: pixelated;
      pointer-events: auto;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      will-change: transform;
    }
    .pet:active { cursor: grabbing; }
    .bubble {
      position: fixed;
      top: 0;
      left: 0;
      padding: 4px 8px;
      border-radius: 8px;
      background: #fffbe8;
      color: #2b2b2b;
      border: 2px solid #2b2b2b;
      /* The bundled pixel font has no Japanese glyphs, so lean on the system stack. */
      font: 13px/1.3 -apple-system, "Hiragino Sans", "Yu Gothic", Meiryo,
        "Noto Sans JP", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 140ms ease-out;
      will-change: transform, opacity;
    }
    .bubble.visible { opacity: 1; }
  `;

  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLES);
  shadow.adoptedStyleSheets = [sheet];

  const petEl = document.createElement("div");
  petEl.className = "pet";
  const bubbleEl = document.createElement("div");
  bubbleEl.className = "bubble";
  shadow.append(bubbleEl, petEl);
  document.documentElement.appendChild(host);

  let bubbleTimer = null;
  const say = (text) => {
    bubbleEl.textContent = text;
    bubbleEl.classList.add("visible");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove("visible"), BUBBLE_MS);
  };

  const sprite = new NS.Sprite(petEl, CHARACTER, SCALE);
  const pet = new NS.Pet(sprite, { say });
  NS.attachInput(petEl, pet);

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
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // rAF is throttled in background tabs; resync the clock so dt stays sane on return.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lastTime = performance.now();
  });
  window.addEventListener("resize", () => pet.onResize());
})();
