// Pet Room controller — the Talking Tom-style screen. Wires the shared pet engine
// (Sprite + Pet + input) to the 3 stat bars, drag-and-drop feeding/playing/balls,
// the coin economy, the Bedroom mic, and the Shop. Exposed as window.__tamagotchi.Room;
// driven by app.js.
(() => {
  const NS = (window.__tamagotchi ??= {});
  const Economy = NS.Economy; // loaded before room.js in index.html

  const SCALE = 2.2; // big focal pet: 32 * 2.2 = 70.4px
  const MAX_DT = 0.05;
  const ECONOMY_KEY = "tama-economy";
  const BUBBLE_MS = 1600;
  const BATTERY_POLL_MS = 30_000;
  const PERSIST_MS = 5_000;
  const TIRED_COOLDOWN_MS = 7_000;

  // Coin popups and poop only spawn in the Game Room (the "field"-type room), not
  // the Kitchen or Bedroom, matching Pou's field-vs-kitchen split.
  const COIN_SPAWN_MIN_MS = 25_000;
  const COIN_SPAWN_MAX_MS = 50_000;
  const COIN_LIFETIME_MS = 8_000;
  const COIN_REWARD_MIN = 5;
  const COIN_REWARD_MAX = 10;
  const POOP_SPAWN_MIN_MS = 60_000;
  const POOP_SPAWN_MAX_MS = 120_000;
  const POOP_LIFETIME_MS = 25_000;
  const POOP_REWARD_MIN = 10;
  const POOP_REWARD_MAX = 15;
  const DROP_HIT_MARGIN = 20; // px of forgiveness around the pet for drag-drop

  const BALL_SIZE = 40;
  const BALL_SHELF_MARGIN = 8;
  const MAX_ACTIVE_BOUNCERS = 4;
  const SHELF_HOLD_MS = 500; // how long a returned ball rests before bouncing again
  const TAP_THRESHOLD_PX = 6;

  const MIC_PITCH = 1.6; // classic Talking-Tom chipmunk playback rate

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
  const BUY_LABEL = { en: "Buy", ja: "購入", ko: "구매" };
  const OWNED_LABEL = { en: "Owned", ja: "所有済み", ko: "보유중" };
  const EQUIP_LABEL = { en: "Equip", ja: "使用する", ko: "적용" };
  const BALL_LOCKED_HINT = { en: "Buy me in the Shop! 🛒", ja: "ショップで買ってね！🛒", ko: "상점에서 구매하세요! 🛒" };
  const MIC_DENIED = { en: "Mic access denied 🎤", ja: "マイクを使えません 🎤", ko: "마이크 접근 거부됨 🎤" };
  const TASKS_KEY = "tama-tasks"; // owned/written by app.js's Pomodoro screen; read fresh here
  const TASK_TAG_MS = 3000;

  // 3 fixed, always-free rooms. "type" drives which bottom panel shows (food tray,
  // ball shelf, mic) and which room the coin/poop spawns are gated to ("field").
  // Solid colors are the zero-cost default background; a room's optional picture
  // background (bought in that room's Shop tab) overrides this — see applyRoomVisuals().
  const ROOMS = {
    kitchen: { id: "kitchen", type: "kitchen", bg: "#ffe9c7", names: { en: "Kitchen", ja: "キッチン", ko: "주방" } },
    gameroom: { id: "gameroom", type: "field", bg: "#d6f5ff", names: { en: "Game Room", ja: "ゲームルーム", ko: "게임룸" } },
    bedroom: { id: "bedroom", type: "bedroom", bg: "#e6dcff", names: { en: "Bedroom", ja: "寝室", ko: "침실" } },
  };
  const ROOM_ORDER = ["kitchen", "gameroom", "bedroom"];

  // Which shop tabs show up per room — each room's own goods, plus a shared
  // Backgrounds tab (Bedroom has no good of its own, so it sells characters).
  const SHOP_TABS = {
    kitchen: ["drinks", "sweets", "meals", "backgrounds"],
    gameroom: ["balls", "backgrounds"],
    bedroom: ["characters", "backgrounds"],
  };
  const SHOP_TAB_LABELS = {
    drinks: { en: "Drinks", ja: "ドリンク", ko: "음료" },
    sweets: { en: "Sweets", ja: "スイーツ", ko: "디저트" },
    meals: { en: "Meals", ja: "ごはん", ko: "식사" },
    balls: { en: "Balls", ja: "ボール", ko: "공" },
    characters: { en: "Characters", ja: "キャラクター", ko: "캐릭터" },
    backgrounds: { en: "Backgrounds", ja: "背景", ko: "배경" },
  };
  const DEFAULT_BG_LABEL = { en: "Default", ja: "デフォルト", ko: "기본" };
  const CHARACTER_NAMES = {
    pink: { en: "Pinky", ja: "ピンキー", ko: "핑키" },
    owlet: { en: "Owlet", ja: "アウレット", ko: "아울렛" },
    dude: { en: "Dudy", ja: "デュディ", ko: "듀디" },
  };
  const CHARACTER_EMOJI = { pink: "🌸", owlet: "🦉", dude: "😎" };

  const pick = (dict, lang) => {
    const list = dict[lang] || dict.ja;
    return list[Math.floor(Math.random() * list.length)];
  };
  const localize = (dict, lang) => dict[lang] || dict.en || dict.ja;
  const randomBetween = (min, max) => min + Math.random() * (max - min);

  let els, sprite, pet, stats, dustSprite, economy;
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
  let wasAirborne = false;
  let taskTagTimer = null;
  let currentScreen = "room"; // "room" | "shop" — Room's own top-level sub-view.
  // "Alarm" is not one of these: it navigates away to the top-level Pomodoro
  // screen (see app.js), rather than being an in-room state like Shop is.
  let shopCategory = "meals";
  let nextCoinAt = 0;
  let nextPoopAt = 0;
  let dragState = null; // { kind, item, originEl, ghost } while a tray item is being dragged
  let balls = []; // Game Room ball-shelf/bounce state, see renderBallShelf()

  // --- mic (Bedroom): Talking-Tom-style record + pitch-shifted playback --------
  let micState = "idle";
  let mediaRecorder = null;
  let micChunks = [];
  let micStream = null;

  function statsKey() {
    return `tama-stats:${character}`;
  }

  function say(text) {
    els.bubble.textContent = text;
    els.bubble.classList.add("visible");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => els.bubble.classList.remove("visible"), BUBBLE_MS);
  }

  function spawnFx(content, opts = {}) {
    const { coin = false, x, y } = opts;
    const fx = document.createElement("span");
    fx.className = "fx" + (coin ? " fx-coin" : "");
    fx.textContent = content;
    fx.style.left = (x ?? pet.x + sprite.size / 2 - 13) + "px";
    fx.style.top = (y ?? pet.y - 10) + "px";
    els.stage.appendChild(fx);
    setTimeout(() => fx.remove(), 900);
  }

  // Centralizes the add-coins + persist + re-render-badge + floating-feedback
  // sequence that used to be duplicated across useFood/useToy/spawnPickup.
  function awardCoins(amount, pos) {
    economy.addCoins(amount);
    persistEconomy();
    renderCoinBadge();
    spawnFx("+" + amount, { coin: true, x: pos?.x, y: pos?.y });
  }

  function loadStats() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(statsKey()));
    } catch {
      saved = null;
    }
    stats = new NS.PetStats(saved);
  }

  function persist() {
    try {
      localStorage.setItem(statsKey(), JSON.stringify(stats.snapshot()));
    } catch {
      /* localStorage unavailable — stats stay session-only */
    }
  }

  function loadEconomy() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(ECONOMY_KEY));
    } catch {
      saved = null;
    }
    economy = new Economy(saved, character);
  }

  function persistEconomy() {
    try {
      localStorage.setItem(ECONOMY_KEY, JSON.stringify(economy.snapshot()));
    } catch {
      /* localStorage unavailable — economy stays session-only */
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

    if (stats.staminaKnown && stats.charging) {
      els.valStamina.style.color = "var(--stamina)";
    } else {
      els.valStamina.style.color = "";
    }
  }

  function renderCoinBadge() {
    els.coinCount.textContent = economy.coins;
    els.shopCoinCount.textContent = economy.coins;
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

    // The pet itself (and its dust/bubble/tired-flinch/spawns/balls) only exists
    // visually while a Room is showing — not while browsing the Shop. Stats keep
    // ticking regardless, same "background" philosophy as the Pomodoro timer.
    const petVisible = currentScreen === "room";

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
      applyBehavior(now);
      positionBubble();
      updateDust(dt);
      updateSpawns(now);
      updateBalls(dt);
    }
    renderBars();

    rafId = requestAnimationFrame(frame);
  }

  // --- feeding / playing: triggered only by a successful drag-drop ------------
  function useFood(item) {
    if (gameOver) return;
    if (!economy.consumeFood(item.id)) return; // shouldn't happen; tray only shows owned items
    stats.feed(item.satiety);
    pet.eat();
    spawnFx(item.emoji);
    awardCoins(Economy.FEED_COIN_REWARD, { x: pet.x + sprite.size / 2 + 6, y: pet.y - 24 });
    say(pick(FEED_PHRASES, lang));
    renderBars();
  }

  function useToy(item) {
    if (gameOver) return;
    stats.play(item.satietyCost);
    pet.playful(item.forceAnim);
    spawnFx("🎉");
    awardCoins(item.coinReward, { x: pet.x + sprite.size / 2 + 6, y: pet.y - 24 });
    say(pick(PLAY_PHRASES, lang));
    renderBars();
  }

  // --- game over / revive ------------------------------------------------------
  function enterGameOver() {
    if (gameOver) return;
    gameOver = true;
    pet.die();
    els.itemTray.innerHTML = ""; // nothing to feed/play with while fainted
    clearBallLayer();
    stopMicIfActive();
    els.gameover.hidden = false;
    clearTimeout(bubbleTimer);
    els.bubble.classList.remove("visible"); // don't leave a stray bubble under the modal
  }

  function revive() {
    if (!gameOver) return;
    stats.reset();
    pet.revive();
    gameOver = false;
    els.gameover.hidden = true;
    renderBottomPanel();
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
    } else if (pet.state === "run") {
      el.classList.add("visible");
      dustSprite.play("dust_run");
    } else if (dustSprite.name !== "dust_jump") {
      el.classList.remove("visible");
    }

    if (el.classList.contains("visible")) dustSprite.tick(dt);
  }

  // --- coin / poop stage spawns (Game Room only) -------------------------------
  function randomStagePos(size) {
    const w = els.stage.clientWidth;
    const h = els.stage.clientHeight;
    return {
      x: randomBetween(8, Math.max(8, w - size - 8)),
      y: randomBetween(8, Math.max(8, h - size - 8)),
    };
  }

  function spawnPickup(className, content, reward, lifetimeMs, pos) {
    const el = document.createElement("div");
    el.className = className;
    if (content instanceof Node) el.appendChild(content);
    else el.textContent = content;
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";

    const fadeTimer = setTimeout(() => el.remove(), lifetimeMs);
    el.addEventListener(
      "click",
      () => {
        clearTimeout(fadeTimer);
        awardCoins(reward, pos);
        el.remove();
      },
      { once: true }
    );
    els.stage.appendChild(el);
  }

  function spawnCoin() {
    const icon = document.createElement("span");
    icon.className = "coin-icon big";
    const reward = Math.round(randomBetween(COIN_REWARD_MIN, COIN_REWARD_MAX));
    spawnPickup("stage-pickup coin", icon, reward, COIN_LIFETIME_MS, randomStagePos(32));
  }

  function spawnPoop() {
    const size = 28;
    const x = Math.min(
      Math.max(pet.x + sprite.size / 2 - size / 2, 4),
      Math.max(4, els.stage.clientWidth - size - 4)
    );
    const y = Math.min(pet.y + sprite.size - size / 2, Math.max(4, els.stage.clientHeight - size - 4));
    const reward = Math.round(randomBetween(POOP_REWARD_MIN, POOP_REWARD_MAX));
    spawnPickup("stage-pickup poop", "💩", reward, POOP_LIFETIME_MS, { x, y });
  }

  function updateSpawns(nowMs) {
    const room = currentRoomDef();
    if (!room || room.type !== "field") return;
    if (nowMs >= nextCoinAt) {
      spawnCoin();
      nextCoinAt = nowMs + randomBetween(COIN_SPAWN_MIN_MS, COIN_SPAWN_MAX_MS);
    }
    if (nowMs >= nextPoopAt) {
      spawnPoop();
      nextPoopAt = nowMs + randomBetween(POOP_SPAWN_MIN_MS, POOP_SPAWN_MAX_MS);
    }
  }

  // --- drag-and-drop tray: food (Kitchen only) ---------------------------------
  function renderTray() {
    els.itemTray.innerHTML = "";
    if (gameOver) return;

    for (const item of economy.ownedFoodList()) {
      const el = document.createElement("div");
      el.className = "tray-item";
      el.textContent = item.emoji;
      if (item.quantity !== Infinity) {
        const qty = document.createElement("span");
        qty.className = "tray-item-qty";
        qty.textContent = "×" + item.quantity;
        el.appendChild(qty);
      }
      el.addEventListener("pointerdown", (e) => startDrag(e, el, item));
      els.itemTray.appendChild(el);
    }
  }

  function startDrag(e, originEl, item) {
    if (gameOver || dragState) return;
    e.preventDefault();
    originEl.classList.add("dragging");

    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = item.emoji;
    document.body.appendChild(ghost);

    const move = (x, y) => {
      ghost.style.transform = `translate3d(${x - 28}px, ${y - 28}px, 0)`; // 28 = half of 56px
    };
    move(e.clientX, e.clientY);

    dragState = { item, originEl, ghost };

    const onMove = (ev) => move(ev.clientX, ev.clientY);
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      finishDrag(ev.clientX, ev.clientY);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function hitTestPet(x, y) {
    const petRect = els.petEl.getBoundingClientRect();
    return (
      x >= petRect.left - DROP_HIT_MARGIN &&
      x <= petRect.right + DROP_HIT_MARGIN &&
      y >= petRect.top - DROP_HIT_MARGIN &&
      y <= petRect.bottom + DROP_HIT_MARGIN
    );
  }

  function finishDrag(x, y) {
    if (!dragState) return;
    const { item, originEl, ghost } = dragState;
    dragState = null;

    if (hitTestPet(x, y) && !gameOver) {
      ghost.remove();
      originEl.classList.remove("dragging");
      useFood(item);
      renderTray(); // quantities/coins may have changed
      return;
    }

    // Miss (or the pet fainted mid-drag): snap the ghost back to its tray slot.
    const originRect = originEl.getBoundingClientRect();
    ghost.classList.add("snapping");
    requestAnimationFrame(() => {
      ghost.style.transform = `translate3d(${originRect.left}px, ${originRect.top}px, 0)`;
    });
    ghost.addEventListener(
      "transitionend",
      () => {
        ghost.remove();
        originEl.classList.remove("dragging");
      },
      { once: true }
    );
  }

  // --- Game Room: bouncing ball shelf ------------------------------------------
  function clearBallLayer() {
    if (els.ballLayer) els.ballLayer.innerHTML = "";
    balls = [];
  }

  function positionBall(ball) {
    ball.el.style.transform = `translate3d(${ball.x}px, ${ball.y}px, 0)`;
  }

  function launchBall(ball) {
    if (ball.state !== "shelved") return;
    ball.state = "bouncing";
    ball.vx = (Math.random() > 0.5 ? 1 : -1) * randomBetween(60, 140);
    ball.vy = -randomBetween(250, 400);
  }

  function renderBallShelf() {
    if (!els.ballLayer) return;
    els.ballLayer.innerHTML = "";
    balls = [];

    const allBalls = Object.values(Economy.CATALOG.toys);
    const ownedIds = new Set(economy.ownedToys);
    const stageW = els.stage.clientWidth;
    const stageH = els.stage.clientHeight;
    const slotGap = stageW / (allBalls.length + 1);

    allBalls.forEach((item, i) => {
      const owned = ownedIds.has(item.id);
      const homeX = Math.round(slotGap * (i + 1) - BALL_SIZE / 2);
      const homeY = Math.round(stageH - BALL_SIZE - BALL_SHELF_MARGIN);

      const el = document.createElement("div");
      el.className = "ball-sprite" + (owned ? "" : " locked");
      el.textContent = item.emoji;
      els.ballLayer.appendChild(el);

      const ball = { item, el, x: homeX, y: homeY, vx: 0, vy: 0, homeX, homeY, state: owned ? "shelved" : "locked" };
      balls.push(ball);
      positionBall(ball);

      if (owned) {
        el.addEventListener("pointerdown", (e) => onBallPointerDown(e, ball));
      } else {
        el.addEventListener("pointerdown", () => say(localize(BALL_LOCKED_HINT, lang)));
      }
    });

    // Stagger a capped subset of owned balls into bouncing so the stage doesn't
    // feel chaotic with all 6 active at once; the rest cycle in via sendBallToShelf.
    balls
      .filter((b) => b.state === "shelved")
      .slice(0, MAX_ACTIVE_BOUNCERS)
      .forEach((b, i) => setTimeout(() => launchBall(b), i * 400));
  }

  function updateBalls(dt) {
    if (balls.length === 0) return;
    const bounds = { width: els.stage.clientWidth, height: els.stage.clientHeight, size: BALL_SIZE };
    for (const ball of balls) {
      if (ball.state !== "bouncing") continue;
      NS.BallPhysics.stepBall(ball, dt, bounds);
      positionBall(ball);
    }
  }

  function sendBallToShelf(ball) {
    ball.state = "returning";
    ball.x = ball.homeX;
    ball.y = ball.homeY;
    ball.el.style.transition = "transform 0.3s ease-out";
    positionBall(ball);
    setTimeout(() => {
      ball.el.style.transition = "";
      ball.state = "shelved";
      setTimeout(() => launchBall(ball), SHELF_HOLD_MS);
    }, 320);
  }

  function resumeBounceAt(ball, clientX, clientY, opts = {}) {
    const stageRect = els.stage.getBoundingClientRect();
    ball.x = Math.min(Math.max(clientX - stageRect.left - BALL_SIZE / 2, 0), els.stage.clientWidth - BALL_SIZE);
    ball.y = Math.min(Math.max(clientY - stageRect.top - BALL_SIZE / 2, 0), els.stage.clientHeight - BALL_SIZE);
    ball.vx = opts.vx ?? (Math.random() > 0.5 ? 1 : -1) * randomBetween(40, 100);
    ball.vy = opts.vy ?? 0;
    ball.state = "bouncing";
    positionBall(ball);
  }

  function finishBallDrag(ball, ghost, x, y) {
    ghost.remove();
    if (hitTestPet(x, y) && !gameOver) {
      useToy(ball.item);
      resumeBounceAt(ball, x, y, { vx: 0, vy: -randomBetween(150, 300) });
      return;
    }
    // A ball's "origin" is a moving physics object, not a static tray slot, so a
    // miss just resumes bouncing from the drop point rather than snapping back.
    resumeBounceAt(ball, x, y);
  }

  function onBallPointerDown(e, ball) {
    if (ball.state === "locked" || ball.state === "dragged" || ball.state === "returning") return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost = null;

    const onMove = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > TAP_THRESHOLD_PX) {
        dragging = true;
        ball.state = "dragged";
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.textContent = ball.item.emoji;
        document.body.appendChild(ghost);
      }
      if (dragging) {
        ghost.style.transform = `translate3d(${ev.clientX - 28}px, ${ev.clientY - 28}px, 0)`;
      }
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragging) finishBallDrag(ball, ghost, ev.clientX, ev.clientY);
      else sendBallToShelf(ball);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // --- Bedroom: mic record + pitch-shifted playback ----------------------------
  function stopMicIfActive() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    micState = "idle";
    els.micBtn?.classList.remove("recording");
  }

  async function toggleMic() {
    if (gameOver) return;
    if (micState === "recording") {
      mediaRecorder.stop();
      return;
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      say(localize(MIC_DENIED, lang));
      return;
    }
    micChunks = [];
    mediaRecorder = new MediaRecorder(micStream);
    mediaRecorder.ondataavailable = (e) => micChunks.push(e.data);
    mediaRecorder.onstop = () => {
      micStream?.getTracks().forEach((t) => t.stop());
      micStream = null;
      playPitchedRecording();
    };
    mediaRecorder.start();
    micState = "recording";
    els.micBtn?.classList.add("recording");
  }

  async function playPitchedRecording() {
    micState = "idle";
    els.micBtn?.classList.remove("recording");
    if (micChunks.length === 0) return;
    try {
      const ctx = NS.getAudioContext();
      const buf = await new Blob(micChunks, { type: "audio/webm" }).arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf);
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.playbackRate.value = MIC_PITCH;
      source.connect(ctx.destination);
      const durationMs = (decoded.duration / MIC_PITCH) * 1000;
      els.petEl.style.setProperty("--talk-dur", durationMs / 1000 + "s");
      els.petEl.classList.add("talking");
      source.onended = () => els.petEl.classList.remove("talking");
      source.start();
    } catch {
      /* decode/playback failure — nothing to recover, just drop it */
    }
  }

  // --- shop ---------------------------------------------------------------------
  function shopCardBase(icon, name) {
    const card = document.createElement("div");
    card.className = "shop-item";
    const iconEl = document.createElement("span");
    iconEl.className = "shop-item-icon";
    iconEl.textContent = icon;
    const nameEl = document.createElement("span");
    nameEl.className = "shop-item-name";
    nameEl.textContent = name;
    card.append(iconEl, nameEl);
    return card;
  }

  function priceRow(price) {
    const row = document.createElement("div");
    row.className = "shop-item-price";
    const coin = document.createElement("span");
    coin.className = "coin-icon";
    row.append(coin, document.createTextNode(String(price)));
    return row;
  }

  function buyButton(owned, price, label, onBuy) {
    const btn = document.createElement("button");
    btn.className = "btn" + (owned ? " owned" : "");
    btn.textContent = owned ? localize(OWNED_LABEL, lang) : label ?? localize(BUY_LABEL, lang);
    btn.disabled = owned || !economy.canAfford(price);
    btn.addEventListener("click", onBuy);
    return btn;
  }

  function renderFoodCard(item) {
    const card = shopCardBase(item.emoji, localize(item.names, lang));
    card.appendChild(priceRow(item.price));
    const qty = document.createElement("span");
    qty.className = "shop-item-qty";
    qty.textContent = "×" + economy.foodQuantity(item.id);
    card.appendChild(qty);
    card.appendChild(
      buyButton(false, item.price, null, () => {
        if (economy.buyFood(item.id)) {
          persistEconomy();
          renderShop();
          renderTray();
          renderCoinBadge();
        }
      })
    );
    return card;
  }

  function renderToyCard(item) {
    const card = shopCardBase(item.emoji, localize(item.names, lang));
    const owned = economy.ownedToys.includes(item.id);
    if (!owned) card.appendChild(priceRow(item.price));
    card.appendChild(
      buyButton(owned, item.price, null, () => {
        if (economy.buyToy(item.id)) {
          persistEconomy();
          renderShop();
          if (currentRoomDef().type === "field") renderBallShelf();
          renderCoinBadge();
        }
      })
    );
    return card;
  }

  function renderCharacterCard(item) {
    const card = shopCardBase(CHARACTER_EMOJI[item.id] || "🐣", localize(CHARACTER_NAMES[item.id] || {}, lang) || item.id);
    const owned = economy.ownedCharacters.includes(item.id);
    if (!owned) card.appendChild(priceRow(item.price));
    card.appendChild(
      buyButton(owned, item.price, null, () => {
        if (economy.buyCharacter(item.id)) {
          persistEconomy();
          renderShop();
          renderCoinBadge();
        }
      })
    );
    return card;
  }

  function renderBackgroundShop() {
    const room = currentRoomDef();
    const list = Economy.CATALOG.backgrounds[room.id] || [];
    const owned = economy.ownedBackgrounds[room.id];
    const current = economy.currentBackgroundId[room.id];

    const defaultCard = shopCardBase("🎨", localize(DEFAULT_BG_LABEL, lang));
    defaultCard.appendChild(
      buyButton(current === null, 0, localize(EQUIP_LABEL, lang), () => {
        economy.setCurrentBackground(room.id, null);
        persistEconomy();
        applyRoomVisuals();
        renderShop();
      })
    );
    els.shopGrid.appendChild(defaultCard);

    list.forEach((item, i) => {
      const isOwned = owned.includes(item.id);
      const isCurrent = current === item.id;
      const card = shopCardBase("🖼️", `${localize(DEFAULT_BG_LABEL, lang)} ${i + 2}`);
      if (!isOwned) card.appendChild(priceRow(item.price));
      card.appendChild(
        buyButton(isCurrent, item.price, isOwned ? localize(EQUIP_LABEL, lang) : null, () => {
          if (isOwned) {
            economy.setCurrentBackground(room.id, item.id);
          } else if (!economy.buyBackground(room.id, item.id)) {
            return;
          }
          persistEconomy();
          applyRoomVisuals();
          renderShop();
        })
      );
      els.shopGrid.appendChild(card);
    });
  }

  function renderShopTabs() {
    const room = currentRoomDef();
    const tabs = SHOP_TABS[room.id] || [];
    if (!tabs.includes(shopCategory)) shopCategory = tabs[0];
    els.shopTabs.innerHTML = "";
    for (const cat of tabs) {
      const btn = document.createElement("button");
      btn.className = "shop-tab" + (cat === shopCategory ? " active" : "");
      btn.textContent = localize(SHOP_TAB_LABELS[cat], lang);
      btn.addEventListener("click", () => {
        shopCategory = cat;
        renderShop();
      });
      els.shopTabs.appendChild(btn);
    }
  }

  function renderShop() {
    renderCoinBadge();
    renderShopTabs();
    els.shopGrid.innerHTML = "";

    if (shopCategory === "backgrounds") {
      renderBackgroundShop();
    } else if (shopCategory === "balls") {
      for (const item of Object.values(Economy.CATALOG.toys)) {
        if (item.id === Economy.DEFAULT_TOY_ID) continue; // the ball is always owned
        els.shopGrid.appendChild(renderToyCard(item));
      }
    } else if (shopCategory === "characters") {
      for (const item of Object.values(Economy.CATALOG.characters)) {
        if (item.id === Economy.DEFAULT_CHARACTER_ID) continue; // pink is always owned
        els.shopGrid.appendChild(renderCharacterCard(item));
      }
    } else {
      // food sub-categories: drinks / sweets / meals
      for (const item of Object.values(Economy.CATALOG.foods)) {
        if (item.category !== shopCategory || item.id === Economy.FREE_FOOD_ID) continue;
        els.shopGrid.appendChild(renderFoodCard(item));
      }
    }
  }

  // --- rooms: background + per-room bottom panel + the field-swiper -----------
  function currentRoomDef() {
    return ROOMS[economy.currentRoomId];
  }

  function applyRoomVisuals() {
    const room = currentRoomDef();
    if (!room) return;

    const bgId = economy.currentBackgroundId[room.id];
    const bgItem = bgId && (Economy.CATALOG.backgrounds[room.id] || []).find((b) => b.id === bgId);
    if (bgItem) {
      els.stage.style.backgroundImage = `url("${chrome.runtime.getURL("assets/" + bgItem.image)}")`;
      els.stage.style.backgroundColor = "";
    } else {
      els.stage.style.backgroundImage = "";
      els.stage.style.backgroundColor = room.bg;
    }

    els.swiperLabel.textContent = localize(room.names, lang);
    renderBottomPanel();
  }

  // Exactly one of the tray / ball-shelf / mic panel is shown at a time, keyed
  // off the current room's type.
  function renderBottomPanel() {
    const room = currentRoomDef();

    els.itemTray.style.display = room.type === "kitchen" ? "flex" : "none";
    if (els.micPanel) els.micPanel.style.display = room.type === "bedroom" ? "flex" : "none";

    if (room.type === "kitchen") renderTray();
    else els.itemTray.innerHTML = "";

    if (room.type === "field") renderBallShelf();
    else clearBallLayer();

    if (room.type !== "bedroom") stopMicIfActive();
  }

  function cycleRoom(direction) {
    const idx = ROOM_ORDER.indexOf(economy.currentRoomId);
    const next = ROOM_ORDER[(idx + direction + ROOM_ORDER.length) % ROOM_ORDER.length];
    economy.setCurrentRoom(next);
    persistEconomy();
    applyRoomVisuals();
  }

  function mount() {
    if (els) return;
    els = {
      stage: document.getElementById("stage"),
      petEl: document.getElementById("pet"),
      dust: document.getElementById("dust"),
      ballLayer: document.getElementById("ball-layer"),
      bubble: document.getElementById("bubble"),
      taskTag: document.getElementById("task-tag"),
      fillHp: document.getElementById("fill-hp"),
      fillSatiety: document.getElementById("fill-satiety"),
      fillStamina: document.getElementById("fill-stamina"),
      valHp: document.getElementById("val-hp"),
      valSatiety: document.getElementById("val-satiety"),
      valStamina: document.getElementById("val-stamina"),
      coinCount: document.getElementById("coin-count"),
      shopCoinCount: document.getElementById("shop-coin-count"),
      gameover: document.getElementById("gameover"),
      reviveBtn: document.getElementById("btn-revive"),
      itemTray: document.getElementById("item-tray"),
      micPanel: document.getElementById("mic-panel"),
      micBtn: document.getElementById("mic-btn"),

      swiper: document.getElementById("field-swiper"),
      swiperLabel: document.getElementById("swiper-label"),
      swiperPrev: document.getElementById("swiper-prev"),
      swiperNext: document.getElementById("swiper-next"),
      shopView: document.getElementById("shop-view"),
      shopGrid: document.getElementById("shop-grid"),
      shopTabs: document.getElementById("shop-tabs"),
      groups: {
        room: document.getElementById("actions-room"),
        shop: document.getElementById("actions-shop"),
      },
    };

    const getBounds = () => ({
      width: els.stage.clientWidth,
      height: els.stage.clientHeight,
    });
    sprite = new NS.Sprite(els.petEl, character, SCALE);
    pet = new NS.Pet(sprite, { say, getBounds });
    NS.attachInput(els.petEl, pet); // poke / drag / throw
    dustSprite = new NS.Sprite(els.dust, character, SCALE);

    els.reviveBtn.addEventListener("click", revive);
    els.micBtn?.addEventListener("click", toggleMic);
    // Additive: input.js already preventDefault()s the native menu on the pet for
    // all three hosts. This listener is room-only, so the extension/overlay are
    // untouched by the task-reveal feature.
    els.petEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showCurrentTask();
    });

    els.swiperPrev.addEventListener("click", () => cycleRoom(-1));
    els.swiperNext.addEventListener("click", () => cycleRoom(1));
    document.querySelector(".actions-container").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "shop") changeScreen("shop");
      else if (action === "field") changeScreen("room");
      // "alarm" buttons are handled separately in app.js (they open the
      // top-level Pomodoro screen) — nothing to do here.
    });

    window.addEventListener("resize", () => {
      if (currentScreen === "room") {
        pet.onResize();
        if (currentRoomDef().type === "field") renderBallShelf();
      }
    });
    window.addEventListener("beforeunload", () => {
      persist();
      persistEconomy();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        persist();
        persistEconomy();
      }
    });

    window.desktopBridge.onBatteryChanged?.(() => {
      pollBattery();
    });
  }

  // Character art (idle preview, dust) is per-character, so the room's
  // decorative sprites need to be repointed whenever the chosen friend changes.
  function applyCharacter(char) {
    character = char;
    sprite.setCharacter(char);
    dustSprite.setCharacter(char);
  }

  function changeScreen(screenName) {
    currentScreen = screenName;
    els.groups.room.classList.toggle("active", screenName === "room");
    els.groups.shop.classList.toggle("active", screenName === "shop");

    if (screenName === "room") {
      els.shopView.style.display = "none";
      els.stage.style.display = "block";
      els.swiper.style.display = "flex";
      applyRoomVisuals();
      pet.onResize();
    } else {
      els.stage.style.display = "none";
      els.swiper.style.display = "none";
      els.itemTray.style.display = "none";
      if (els.micPanel) els.micPanel.style.display = "none";
      stopMicIfActive();
      els.shopView.style.display = "flex";
      renderShop();
    }
  }

  // Called by the router when entering the room. Layout must be visible first so
  // the stage has real dimensions.
  function start(char, language) {
    mount();
    lang = language || "ja";
    applyCharacter(char);
    pet.setLanguage(lang);

    loadEconomy();
    loadStats();
    gameOver = false;
    els.gameover.hidden = true;
    if (stats.hp <= 0) enterGameOver(); // offline decay already emptied HP
    renderBars();
    renderCoinBadge();
    pollBattery();

    const now = performance.now();
    nextCoinAt = now + randomBetween(COIN_SPAWN_MIN_MS, COIN_SPAWN_MAX_MS);
    nextPoopAt = now + randomBetween(POOP_SPAWN_MIN_MS, POOP_SPAWN_MAX_MS);

    changeScreen("room"); // always start looking at the current room; also resizes the pet

    running = true;
    lastTime = now;
    rafId = requestAnimationFrame(frame);
    batteryTimer = setInterval(pollBattery, BATTERY_POLL_MS);
    persistTimer = setInterval(() => {
      persist();
      persistEconomy();
    }, PERSIST_MS);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    clearInterval(batteryTimer);
    clearInterval(persistTimer);
    stopMicIfActive();
    persist();
    persistEconomy();
  }

  function setLanguage(language) {
    lang = language || "ja";
    if (pet) pet.setLanguage(lang);
    if (!els) return; // called once at app startup, before the room is ever mounted
    if (currentScreen === "room") applyRoomVisuals();
    else renderShop();
  }

  NS.Room = { start, stop, setLanguage, onAlarm };
})();
