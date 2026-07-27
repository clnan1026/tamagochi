// Pet Room controller — the Talking Tom-style screen. Wires the shared pet engine
// (Sprite + Pet + input) to the 3 stat bars, Feed/Play buttons, poke, and the
// real battery. Exposed as window.__tamagotchi.Room; driven by app.js.
(() => {
  const NS = (window.__tamagotchi ??= {});

  const SCALE = 2.6; // big focal pet: 32 * 2.2 = 70.4px
  const MAX_DT = 0.05;
  const STATS_KEY = "tama-stats";
  const BUBBLE_MS = 1600;
  const BATTERY_POLL_MS = 30_000;
  const PERSIST_MS = 5_000;
  const TIRED_COOLDOWN_MS = 7_000;

  const FEED_PHRASES = {
    en: ["Yum! 😋", "So good!", "More please~", "Nom nom"],
    ja: ["おいしい！ 😋", "もぐもぐ", "もっと〜", "ありがとう！"],
    ko: ["맛있어! 😋", "냠냠", "더 줘~", "고마워!"],
  };
  const PLAY_PHRASES = {
    en: ["Wheee! 🎉", "Again! Again!", "So fun!", "Yay!"],
    ja: ["わーい！ 🎉", "もう一回！", "たのしい！", "やった！"],
    ko: ["신난다! 🎉", "또 하자!", "재밌어!", "야호!"],
  };
  const TIRED_PHRASES = {
    en: ["So sleepy... 😴", "I'm hungry...", "No energy..."],
    ja: ["ねむい… 😴", "おなかすいた…", "つかれた…"],
    ko: ["졸려... 😴", "배고파...", "힘이 없어..."],
  };

  const pick = (dict, lang) => {
    const list = dict[lang] || dict.ja;
    return list[Math.floor(Math.random() * list.length)];
  };

  let els, sprite, pet, stats;
  let lang = "ja";
  let running = false;
  let rafId = null;
  let lastTime = 0;
  let batteryTimer = null;
  let persistTimer = null;
  let tiredAt = 0;
  let bubbleTimer = null;
  let currentScreen = "basic";

  const fieldLabels = {
    basic: { ko: "일반 필드", ja: "基本フィールド", en: "Basic Field" },
    game: { ko: "게임 필드", ja: "ゲームフィールド", en: "Game Field" }
  };

  function say(text) {
    els.bubble.textContent = text;
    els.bubble.classList.add("visible");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => els.bubble.classList.remove("visible"), BUBBLE_MS);
  }

  function spawnFx(emoji) {
    const fx = document.createElement("span");
    fx.className = "fx";
    fx.textContent = emoji;
    fx.style.left = pet.x + sprite.size / 2 - 13 + "px";
    fx.style.top = pet.y - 10 + "px";
    els.stage.appendChild(fx);
    setTimeout(() => fx.remove(), 900);
  }

  function loadStats() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STATS_KEY));
    } catch {
      saved = null;
    }
    stats = new NS.PetStats(saved);
  }

  function persist() {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats.snapshot()));
    } catch {
      /* localStorage unavailable — stats stay session-only */
    }
  }

  async function pollBattery() {
    const bridge = window.desktopBridge;
    if (!bridge?.getBattery) return;
    const b = await bridge.getBattery();
    if (b) stats.setBattery(b.level, b.charging);
  }

  function renderBars() {
    const set = (fill, val, v, known = true) => {
      els[fill].style.width = v + "%";
      els[val].textContent = known ? Math.round(v) : "--";
    };
    set("fillHp", "valHp", stats.hp);
    set("fillSatiety", "valSatiety", stats.satiety);
    set("fillStamina", "valStamina", stats.stamina, stats.staminaKnown);

    // Apply color highlighting to battery text based on charging state
    if (stats.staminaKnown && stats.charging) {
      els.valStamina.style.color = "var(--stamina)"; // Green highlight from design system
    } else {
      els.valStamina.style.color = ""; // Revert to default theme text color
    }
  }

  function applyBehavior(now) {
    // Battery drives how lively the pet is.
    pet.speedScale = stats.exhausted ? 0.35 : stats.sluggish ? 0.6 : 1;

    // When tired/hungry/unwell, flinch and grumble now and then.
    if ((stats.exhausted || stats.starving || stats.unwell) && now - tiredAt > TIRED_COOLDOWN_MS) {
      tiredAt = now;
      if (pet.state === "idle" || pet.state === "walk" || pet.state === "run") {
        pet.poke(); // reuse the hurt flinch
        say(pick(TIRED_PHRASES, lang));
      }
    }
  }

  function positionBubble() {
    const x = pet.x + sprite.size / 2;
    const y = pet.y - 6;
    els.bubble.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  }

  function frame(nowMs) {
    if (!running) return;
    const now = nowMs;
    const dt = Math.min((now - lastTime) / 1000, MAX_DT);
    lastTime = now;

    if (currentScreen === "basic" || currentScreen === "game") {
      pet.update(dt);
    }
    stats.tick(dt);
    applyBehavior(now);
    renderBars();
    positionBubble();

    rafId = requestAnimationFrame(frame);
  }

  function feed() {
    stats.feed();
    pet.hop();
    spawnFx("🍖");
    say(pick(FEED_PHRASES, lang));
    renderBars();
  }

  function play() {
    stats.play();
    pet.hop();
    spawnFx("🎉");
    say(pick(PLAY_PHRASES, lang));
    renderBars();
  }

  function mount() {
    if (els) return;
    els = {
      stage: document.getElementById("stage"),
      petEl: document.getElementById("pet"),
      bubble: document.getElementById("bubble"),
      fillHp: document.getElementById("fill-hp"),
      fillSatiety: document.getElementById("fill-satiety"),
      fillStamina: document.getElementById("fill-stamina"),
      valHp: document.getElementById("val-hp"),
      valSatiety: document.getElementById("val-satiety"),
      valStamina: document.getElementById("val-stamina"),
      feedBtn: document.getElementById("btn-feed"),
      playBtn: document.getElementById("btn-play"),

      // Swiper & Menu items
      swiper: document.getElementById("field-swiper"),
      swiperLabel: document.getElementById("swiper-label"),
      swiperPrev: document.getElementById("swiper-prev"),
      swiperNext: document.getElementById("swiper-next"),
      shopView: document.getElementById("shop-view"),
      alarmView: document.getElementById("alarm-view"),
      groups: {
        basic: document.getElementById("actions-basic"),
        game: document.getElementById("actions-game"),
        shop: document.getElementById("actions-shop"),
        alarm: document.getElementById("actions-alarm"),
      }
    };

    const getBounds = () => {
      let offset = 0;
      if (currentScreen === "basic") {
        offset = 25; // Stand slightly higher in the grass
      } else if (currentScreen === "game") {
        offset = 30; // Stand on the platform above the grid
      }
      return {
        width: els.stage.clientWidth,
        height: els.stage.clientHeight - offset
      };
    };
    sprite = new NS.Sprite(els.petEl, "pink", SCALE);
    pet = new NS.Pet(sprite, { say, getBounds });
    NS.attachInput(els.petEl, pet); // poke / drag / throw

    els.feedBtn.addEventListener("click", feed);
    els.playBtn.addEventListener("click", play);

    // Wire up navigation controls
    els.swiperPrev.addEventListener("click", toggleField);
    els.swiperNext.addEventListener("click", toggleField);

    document.querySelector(".actions-container").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "alarm") {
        changeScreen("alarm");
      } else if (action === "shop") {
        changeScreen("shop");
      } else if (action === "field") {
        changeScreen("basic");
      }
    });

    window.addEventListener("resize", () => {
      if (currentScreen === "basic" || currentScreen === "game") {
        pet.onResize();
      }
    });
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) persist();
    });

    window.desktopBridge.onBatteryChanged?.(() => {
      pollBattery();
    });
  }

  function changeScreen(screenName) {
    currentScreen = screenName;

    // Toggle actions group active visibility
    for (const [name, el] of Object.entries(els.groups)) {
      el.classList.toggle("active", name === screenName);
    }

    // Toggle center views
    if (screenName === "basic" || screenName === "game") {
      els.shopView.style.display = "none";
      els.alarmView.style.display = "none";
      els.stage.style.display = "block";
      els.swiper.style.display = "flex";

      // Change background theme on stage
      els.stage.classList.toggle("field-game", screenName === "game");

      // Update Swiper text
      els.swiperLabel.textContent = fieldLabels[screenName]?.[lang] || fieldLabels[screenName]?.en || "";

      // Re-trigger layout calculations
      pet.onResize();
    } else {
      els.stage.style.display = "none";
      els.swiper.style.display = "none";
      els.shopView.style.display = screenName === "shop" ? "flex" : "none";
      els.alarmView.style.display = screenName === "alarm" ? "flex" : "none";
    }
  }

  function toggleField() {
    changeScreen(currentScreen === "basic" ? "game" : "basic");
  }

  // Called by the router when entering the room. Layout must be visible first so
  // the stage has real dimensions.
  function start(character, language) {
    mount();
    lang = language || "ja";
    sprite.setCharacter(character);
    pet.setLanguage(lang);
    
    loadStats();
    renderBars();
    pollBattery();

    // Always start in basic field
    changeScreen("basic");

    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
    batteryTimer = setInterval(pollBattery, BATTERY_POLL_MS);
    persistTimer = setInterval(persist, PERSIST_MS);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    clearInterval(batteryTimer);
    clearInterval(persistTimer);
    persist();
  }

  function setLanguage(language) {
    lang = language || "ja";
    if (pet) pet.setLanguage(lang);
    if (currentScreen === "basic" || currentScreen === "game") {
      els.swiperLabel.textContent = fieldLabels[currentScreen]?.[lang] || fieldLabels[currentScreen]?.en || "";
    }
  }

  NS.Room = { start, stop, setLanguage };
})();
