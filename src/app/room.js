// Pet Room controller — the Talking Tom-style screen. Wires the shared pet engine
// (Sprite + Pet + input) to the 3 stat bars, Feed/Play buttons, poke, and the
// real battery. Exposed as window.__tamagotchi.Room; driven by app.js.
(() => {
  const NS = (window.__tamagotchi ??= {});

  const SCALE = 3; // big focal pet: 32 * 3 = 96px
  const MAX_DT = 0.05;
  const STATS_KEY = "tama-stats";
  const BUBBLE_MS = 1600;
  const BATTERY_POLL_MS = 30_000;
  const PERSIST_MS = 5_000;
  const TIRED_COOLDOWN_MS = 7_000;
  const ROCK_WIDTH = 48; // 16px sheet * 3
  const PUSH_REACH = 14; // px of overlap before the pet starts pushing

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
  const ALARM_PHRASES = {
    en: ["⏰ Time's up!", "⏰ Break time!", "⏰ Ding ding ding!"],
    ja: ["⏰ 時間だよ！", "⏰ 休憩の時間！", "⏰ ピピピ！"],
    ko: ["⏰ 시간 다 됐어요!", "⏰ 쉬는 시간!", "⏰ 삐삐삐!"],
  };
  const TASK_EMPTY = { en: "No tasks 🎉", ja: "タスクなし 🎉", ko: "할 일 없음 🎉" };
  const TASKS_KEY = "tama-tasks"; // owned/written by app.js's Pomodoro screen; read fresh here
  const TASK_TAG_MS = 3000;

  const pick = (dict, lang) => {
    const list = dict[lang] || dict.ja;
    return list[Math.floor(Math.random() * list.length)];
  };

  let els, sprite, pet, stats, dustSprite;
  let lang = "ja";
  let character = "pink";
  let running = false;
  let gameOver = false;
  let rafId = null;
  let lastTime = 0;
  let batteryTimer = null;
  let persistTimer = null;
  let tiredAt = 0;
  let bubbleTimer = null;
  let rockX = 0; // px from the stage's left edge
  let wasAirborne = false;
  let pushing = false;
  let taskTagTimer = null;
  let currentScreen = "basic"; // "basic" | "game" | "shop" — Room's own sub-view.
  // "Alarm" is not one of these: it navigates away to the top-level Pomodoro
  // screen (see app.js), rather than being an in-room state like Shop is.

  const fieldLabels = {
    basic: { ko: "일반 필드", ja: "基本フィールド", en: "Basic Field" },
    game: { ko: "게임 필드", ja: "ゲームフィールド", en: "Game Field" },
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
    // Slightly higher than the bubble so the two stack instead of overlapping if
    // both happen to be visible at once (e.g. right-click right after a feed).
    els.taskTag.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -140%)`;
  }

  // --- right-click: reveal the current (first unchecked) task -----------------
  function showCurrentTask() {
    if (gameOver) return;
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(TASKS_KEY)) || [];
    } catch {
      list = [];
    }
    const current = list.find((t) => !t.done);
    els.taskTag.textContent = current ? current.text : TASK_EMPTY[lang] || TASK_EMPTY.ja;
    els.taskTag.classList.add("visible");
    clearTimeout(taskTagTimer);
    taskTagTimer = setTimeout(() => els.taskTag.classList.remove("visible"), TASK_TAG_MS);
  }

  // Called by app.js's Pomodoro driver when a session finishes — fires wherever
  // the app is, but the pet only visually reacts if the room is mounted/running.
  function onAlarm() {
    if (!els || !pet || gameOver) return;
    pet.playful(); // physical reaction only (no built-in phrase, unlike poke())
    say(pick(ALARM_PHRASES, lang));
  }

  function frame(nowMs) {
    if (!running) return;
    const now = nowMs;
    const dt = Math.min((now - lastTime) / 1000, MAX_DT);
    lastTime = now;

    // The pet itself (and its rock/dust/bubble/tired-flinch) only exists visually
    // on the Basic/Game field — not while browsing the Shop stub. Stats keep
    // ticking regardless, same "background" philosophy as the Pomodoro timer.
    const petVisible = currentScreen === "basic" || currentScreen === "game";

    if (gameOver) {
      // The pet is fainted and locked; only the death-hold frame needs ticking.
      if (petVisible) pet.update(dt);
      renderBars();
      rafId = requestAnimationFrame(frame);
      return;
    }

    if (petVisible) pet.update(dt);
    stats.tick(dt);
    if (stats.hp <= 0) {
      enterGameOver();
      renderBars();
      rafId = requestAnimationFrame(frame);
      return;
    }

    if (petVisible) {
      updateRock(dt);
      applyBehavior(now);
      positionBubble();
      updateDust(dt);
    }
    renderBars();

    rafId = requestAnimationFrame(frame);
  }

  function feed() {
    if (gameOver) return;
    stats.feed();
    pet.eat();
    spawnFx("🍖");
    say(pick(FEED_PHRASES, lang));
    renderBars();
  }

  function play() {
    if (gameOver) return;
    stats.play();
    pet.playful();
    spawnFx("🎉");
    say(pick(PLAY_PHRASES, lang));
    renderBars();
  }

  // --- game over / revive ------------------------------------------------------
  function enterGameOver() {
    if (gameOver) return;
    gameOver = true;
    pet.die();
    els.feedBtn.disabled = true;
    els.playBtn.disabled = true;
    els.gameover.hidden = false;
    clearTimeout(bubbleTimer);
    els.bubble.classList.remove("visible"); // don't leave a stray bubble under the modal
  }

  function revive() {
    if (!gameOver) return;
    stats.reset();
    pet.revive();
    gameOver = false;
    els.feedBtn.disabled = false;
    els.playBtn.disabled = false;
    els.gameover.hidden = true;
    renderBars();
    persist();
  }

  // --- dust: a second sprite layered on the pet, driven by its state ----------
  function updateDust(dt) {
    const el = els.dust;
    el.style.transform = `translate3d(${pet.x}px, ${pet.y}px, 0)`;

    const justLeftGround = !wasAirborne && pet.state === "air";
    wasAirborne = pet.state === "air";

    if (justLeftGround) {
      el.classList.add("visible");
      dustSprite.play("dust_jump", () => el.classList.remove("visible"), true);
    } else if (pet.state === "run" || pushing) {
      el.classList.add("visible");
      dustSprite.play("dust_run");
    } else if (dustSprite.name !== "dust_jump") {
      el.classList.remove("visible");
    }

    if (el.classList.contains("visible")) dustSprite.tick(dt);
  }

  // --- rock: a prop the walking/running pet pushes -----------------------------
  function rockMax() {
    return Math.max(0, els.stage.clientWidth - ROCK_WIDTH);
  }

  function placeRock(x) {
    rockX = Math.min(Math.max(x, 0), rockMax());
    els.rock.style.transform = `translate3d(${rockX}px, 0, 0)`;
  }

  function updateRock(dt) {
    const grounded = pet.state === "walk" || pet.state === "run";
    const stopPushing = () => {
      if (!pushing) return;
      pushing = false;
      // Pet.update() only calls sprite.play() on a *state* transition, and "push" is
      // a purely visual override here — restore the animation that matches pet.state
      // or it would be stuck showing "push" while still walking/running.
      if (grounded) sprite.play(pet.state);
    };

    if (!grounded) return stopPushing();

    const petCenter = pet.x + sprite.size / 2;
    const rockCenter = rockX + ROCK_WIDTH / 2;
    const touching = Math.abs(petCenter - rockCenter) < sprite.size / 2 + ROCK_WIDTH / 2 - PUSH_REACH;
    const movingToward = (pet.targetX - pet.x) * (rockCenter - petCenter) > 0;

    if (!touching || !movingToward) return stopPushing();

    pushing = true;
    const dir = petCenter < rockCenter ? 1 : -1;
    const speed = pet.state === "run" ? 150 : 60; // matches pet.js RUN_SPEED / WALK_SPEED
    const before = rockX;
    placeRock(rockX + dir * speed * dt);
    sprite.play("push");
    sprite.face(dir);

    if (rockX === before && (rockX <= 0 || rockX >= rockMax())) {
      // Pinned against a wall — send the pet the other way so it doesn't idle-push forever.
      pet.targetX = dir > 0 ? 0 : pet.maxX();
      stopPushing();
    }
  }

  function mount() {
    if (els) return;
    els = {
      stage: document.getElementById("stage"),
      petEl: document.getElementById("pet"),
      dust: document.getElementById("dust"),
      rock: document.getElementById("rock"),
      bubble: document.getElementById("bubble"),
      taskTag: document.getElementById("task-tag"),
      fillHp: document.getElementById("fill-hp"),
      fillSatiety: document.getElementById("fill-satiety"),
      fillStamina: document.getElementById("fill-stamina"),
      valHp: document.getElementById("val-hp"),
      valSatiety: document.getElementById("val-satiety"),
      valStamina: document.getElementById("val-stamina"),
      feedBtn: document.getElementById("btn-feed"),
      playBtn: document.getElementById("btn-play"),
      gameover: document.getElementById("gameover"),
      reviveBtn: document.getElementById("btn-revive"),

      // Field swiper + Shop stub (the "Alarm" action opens the top-level Pomodoro
      // screen instead — wired separately in app.js — so there is no alarmView).
      swiper: document.getElementById("field-swiper"),
      swiperLabel: document.getElementById("swiper-label"),
      swiperPrev: document.getElementById("swiper-prev"),
      swiperNext: document.getElementById("swiper-next"),
      shopView: document.getElementById("shop-view"),
      groups: {
        basic: document.getElementById("actions-basic"),
        game: document.getElementById("actions-game"),
        shop: document.getElementById("actions-shop"),
      },
    };

    const getBounds = () => ({ width: els.stage.clientWidth, height: els.stage.clientHeight });
    sprite = new NS.Sprite(els.petEl, character, SCALE);
    pet = new NS.Pet(sprite, { say, getBounds });
    NS.attachInput(els.petEl, pet); // poke / drag / throw
    dustSprite = new NS.Sprite(els.dust, character, SCALE);

    els.feedBtn.addEventListener("click", feed);
    els.playBtn.addEventListener("click", play);
    els.reviveBtn.addEventListener("click", revive);
    els.rock.addEventListener("click", () => placeRock(els.stage.clientWidth * 0.7));
    // Additive: input.js already preventDefault()s the native menu on the pet for
    // all three hosts. This listener is room-only, so the extension/overlay are
    // untouched by the task-reveal feature.
    els.petEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showCurrentTask();
    });

    els.swiperPrev.addEventListener("click", toggleField);
    els.swiperNext.addEventListener("click", toggleField);
    document.querySelector(".actions-container").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "shop") changeScreen("shop");
      else if (action === "field") changeScreen("basic");
      // "alarm" buttons are handled separately in app.js (they open the
      // top-level Pomodoro screen) — nothing to do here.
    });

    window.addEventListener("resize", () => {
      if (currentScreen === "basic" || currentScreen === "game") {
        pet.onResize();
        placeRock(rockX); // reclamp into the resized stage
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

  // Character art (idle preview, rock, dust) is per-character, so the room's
  // decorative sprites need to be repointed whenever the chosen friend changes.
  function applyCharacter(char) {
    character = char;
    sprite.setCharacter(char);
    dustSprite.setCharacter(char);
    els.rock.style.backgroundImage = `url("${chrome.runtime.getURL(`assets/${char}/rock.png`)}")`;
  }

  function changeScreen(screenName) {
    currentScreen = screenName;

    for (const [name, el] of Object.entries(els.groups)) {
      el.classList.toggle("active", name === screenName);
    }

    if (screenName === "basic" || screenName === "game") {
      els.shopView.style.display = "none";
      els.stage.style.display = "block";
      els.swiper.style.display = "flex";

      // Change background theme on stage
      els.stage.classList.toggle("field-game", screenName === "game");

      // Update Swiper text
      els.swiperLabel.textContent = fieldLabels[screenName]?.[lang] || fieldLabels[screenName]?.en || "";

      // Re-trigger layout calculations
      pet.onResize();
    } else {
      // screenName === "shop"
      els.stage.style.display = "none";
      els.swiper.style.display = "none";
      els.shopView.style.display = "flex";
    }
  }

  function toggleField() {
    changeScreen(currentScreen === "basic" ? "game" : "basic");
  }

  // Called by the router when entering the room. Layout must be visible first so
  // the stage has real dimensions.
  function start(char, language) {
    mount();
    lang = language || "ja";
    applyCharacter(char);
    pet.setLanguage(lang);
    placeRock(0); // left side of the stage to start

    loadStats();
    gameOver = false;
    els.gameover.hidden = true;
    els.feedBtn.disabled = false;
    els.playBtn.disabled = false;
    if (stats.hp <= 0) enterGameOver(); // offline decay already emptied HP
    renderBars();
    pollBattery();

    changeScreen("basic"); // always start in Basic Field; also resizes the pet

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
    // Called once at app startup (before the room is ever mounted) to hydrate
    // the saved language, so `els` may not exist yet.
    if (els && (currentScreen === "basic" || currentScreen === "game")) {
      els.swiperLabel.textContent = fieldLabels[currentScreen]?.[lang] || fieldLabels[currentScreen]?.en || "";
    }
  }

  NS.Room = { start, stop, setLanguage, onAlarm };
})();
