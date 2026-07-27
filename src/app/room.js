// Pet Room controller — the Talking Tom-style screen. Wires the shared pet engine
// (Sprite + Pet + input) to the 3 stat bars, drag-and-drop feeding/playing, the
// coin economy, and the Shop. Exposed as window.__tamagotchi.Room; driven by app.js.
(() => {
  const NS = (window.__tamagotchi ??= {});
  const Economy = NS.Economy; // loaded before room.js in index.html

  const SCALE = 3; // big focal pet: 32 * 3 = 96px
  const MAX_DT = 0.05;
  const STATS_KEY = "tama-stats";
  const ECONOMY_KEY = "tama-economy";
  const BUBBLE_MS = 1600;
  const BATTERY_POLL_MS = 30_000;
  const PERSIST_MS = 5_000;
  const TIRED_COOLDOWN_MS = 7_000;
  const ROCK_WIDTH = 48; // 16px sheet * 3
  const PUSH_REACH = 14; // px of overlap before the pet starts pushing

  // Coin popups and poop only spawn in Field-type rooms (not Kitchen), matching Pou.
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
  const TASKS_KEY = "tama-tasks"; // owned/written by app.js's Pomodoro screen; read fresh here
  const TASK_TAG_MS = 3000;

  // No new scenery art exists — purchased rooms beyond the two original photo
  // fields are CSS-gradient themes.
  const ROOM_GRADIENTS = {
    kitchen: "linear-gradient(#fff1e0, #ffcf9f 70%, #f4a460)",
    sunset: "linear-gradient(#ff9a6c, #ff6f91 55%, #6a3093)",
    midnight: "linear-gradient(#0f2027, #203a43, #2c5364)",
    candy: "linear-gradient(#ffd1ff, #d9b8ff 55%, #fad0c4)",
  };

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
  let rockX = 0; // px from the stage's left edge
  let wasAirborne = false;
  let pushing = false;
  let taskTagTimer = null;
  let currentScreen = "room"; // "room" | "shop" — Room's own top-level sub-view.
  // "Alarm" is not one of these: it navigates away to the top-level Pomodoro
  // screen (see app.js), rather than being an in-room state like Shop is.
  let shopCategory = "foods";
  let nextCoinAt = 0;
  let nextPoopAt = 0;
  let dragState = null; // { kind, item, originEl, ghost } while a tray item is being dragged

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

  function loadEconomy() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(ECONOMY_KEY));
    } catch {
      saved = null;
    }
    economy = new Economy(saved);
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

    // The pet itself (and its rock/dust/bubble/tired-flinch/spawns) only exists
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
      updateRock(dt);
      applyBehavior(now);
      positionBubble();
      updateDust(dt);
      updateSpawns(now);
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
    economy.addCoins(Economy.FEED_COIN_REWARD);
    persistEconomy();
    spawnFx(item.emoji);
    say(pick(FEED_PHRASES, lang));
    renderBars();
    renderCoinBadge();
  }

  function useToy(item) {
    if (gameOver) return;
    stats.play(item.satietyCost);
    pet.playful(item.forceAnim);
    economy.addCoins(item.coinReward);
    persistEconomy();
    spawnFx("🎉");
    say(pick(PLAY_PHRASES, lang));
    renderBars();
    renderCoinBadge();
  }

  // --- game over / revive ------------------------------------------------------
  function enterGameOver() {
    if (gameOver) return;
    gameOver = true;
    pet.die();
    els.itemTray.innerHTML = ""; // nothing to feed/play with while fainted
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
    renderTray();
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
      pet.targetX = dir > 0 ? 0 : pet.maxX();
      stopPushing();
    }
  }

  // --- coin / poop stage spawns -------------------------------------------------
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
        economy.addCoins(reward);
        persistEconomy();
        renderCoinBadge();
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

  // --- drag-and-drop tray: food (Kitchen) or toys (any Field room) ------------
  function renderTray() {
    els.itemTray.innerHTML = "";
    if (gameOver) return;
    const room = currentRoomDef();
    if (!room) return;

    const entries =
      room.type === "kitchen"
        ? economy.ownedFoodList().map((item) => ({ kind: "food", item }))
        : economy.ownedToyList().map((item) => ({ kind: "toy", item }));

    for (const { kind, item } of entries) {
      const el = document.createElement("div");
      el.className = "tray-item";
      el.textContent = item.emoji;
      if (kind === "food" && item.quantity !== Infinity) {
        const qty = document.createElement("span");
        qty.className = "tray-item-qty";
        qty.textContent = "×" + item.quantity;
        el.appendChild(qty);
      }
      el.addEventListener("pointerdown", (e) => startDrag(e, el, kind, item));
      els.itemTray.appendChild(el);
    }
  }

  function startDrag(e, originEl, kind, item) {
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

    dragState = { kind, item, originEl, ghost };

    const onMove = (ev) => move(ev.clientX, ev.clientY);
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      finishDrag(ev.clientX, ev.clientY);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function finishDrag(x, y) {
    if (!dragState) return;
    const { kind, item, originEl, ghost } = dragState;
    dragState = null;

    const petRect = els.petEl.getBoundingClientRect();
    const hit =
      x >= petRect.left - DROP_HIT_MARGIN &&
      x <= petRect.right + DROP_HIT_MARGIN &&
      y >= petRect.top - DROP_HIT_MARGIN &&
      y <= petRect.bottom + DROP_HIT_MARGIN;

    if (hit && !gameOver) {
      ghost.remove();
      originEl.classList.remove("dragging");
      if (kind === "food") useFood(item);
      else useToy(item);
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

  // --- shop ---------------------------------------------------------------------
  function shopCardBase(item) {
    const card = document.createElement("div");
    card.className = "shop-item";
    const icon = document.createElement("span");
    icon.className = "shop-item-icon";
    icon.textContent = item.emoji || "🏡"; // rooms have no emoji; a house stands in
    const name = document.createElement("span");
    name.className = "shop-item-name";
    name.textContent = localize(item.names, lang);
    card.append(icon, name);
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

  function buyButton(owned, price, onBuy) {
    const btn = document.createElement("button");
    btn.className = "btn" + (owned ? " owned" : "");
    btn.textContent = owned ? localize(OWNED_LABEL, lang) : localize(BUY_LABEL, lang);
    btn.disabled = owned || !economy.canAfford(price);
    btn.addEventListener("click", onBuy);
    return btn;
  }

  function renderFoodCard(item) {
    const card = shopCardBase(item);
    card.appendChild(priceRow(item.price));
    const qty = document.createElement("span");
    qty.className = "shop-item-qty";
    qty.textContent = "×" + economy.foodQuantity(item.id);
    card.appendChild(qty);
    card.appendChild(
      buyButton(false, item.price, () => {
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
    const card = shopCardBase(item);
    const owned = economy.ownedToys.includes(item.id);
    if (!owned) card.appendChild(priceRow(item.price));
    card.appendChild(
      buyButton(owned, item.price, () => {
        if (economy.buyToy(item.id)) {
          persistEconomy();
          renderShop();
          renderTray();
          renderCoinBadge();
        }
      })
    );
    return card;
  }

  function renderRoomCard(item) {
    const card = shopCardBase(item);
    const owned = economy.ownedRooms.includes(item.id);
    if (!owned) card.appendChild(priceRow(item.price));
    card.appendChild(
      buyButton(owned, item.price, () => {
        if (economy.buyRoom(item.id)) {
          persistEconomy();
          renderShop();
          renderCoinBadge();
        }
      })
    );
    return card;
  }

  function renderShop() {
    renderCoinBadge();
    els.shopGrid.innerHTML = "";

    if (shopCategory === "foods") {
      for (const item of Object.values(Economy.CATALOG.foods)) {
        if (item.id === Economy.FREE_FOOD_ID) continue; // free kibble isn't "bought"
        els.shopGrid.appendChild(renderFoodCard(item));
      }
    } else if (shopCategory === "toys") {
      for (const item of Object.values(Economy.CATALOG.toys)) {
        if (item.id === Economy.DEFAULT_TOY_ID) continue; // the ball is always owned
        els.shopGrid.appendChild(renderToyCard(item));
      }
    } else {
      for (const item of Object.values(Economy.CATALOG.rooms)) {
        if (Economy.DEFAULT_ROOMS.includes(item.id)) continue; // free rooms aren't "bought"
        els.shopGrid.appendChild(renderRoomCard(item));
      }
    }
  }

  // --- rooms: background + tray-type + the field-swiper ------------------------
  function currentRoomDef() {
    return Economy.CATALOG.rooms[economy.currentRoomId];
  }

  function applyRoomVisuals() {
    const room = currentRoomDef();
    if (!room) return;

    els.stage.style.backgroundImage =
      room.background.kind === "image"
        ? `url("${chrome.runtime.getURL("assets/" + room.background.value)}")`
        : ROOM_GRADIENTS[room.background.value] || "";

    // The plant/teddy decorations were Basic Field's specifically — every other
    // room (including CSS-gradient ones) hides them.
    const showDecor = room.id === "basic";
    els.decorLeft.classList.toggle("hidden", !showDecor);
    els.decorRight.classList.toggle("hidden", !showDecor);

    els.swiperLabel.textContent = localize(room.names, lang);
    renderTray();
  }

  function cycleRoom(direction) {
    const rooms = economy.roomList();
    if (rooms.length === 0) return;
    const idx = Math.max(0, rooms.findIndex((r) => r.id === economy.currentRoomId));
    const next = rooms[(idx + direction + rooms.length) % rooms.length];
    economy.setCurrentRoom(next.id);
    persistEconomy();
    applyRoomVisuals();
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
      decorLeft: document.querySelector("#stage .decor.left"),
      decorRight: document.querySelector("#stage .decor.right"),
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

      swiper: document.getElementById("field-swiper"),
      swiperLabel: document.getElementById("swiper-label"),
      swiperPrev: document.getElementById("swiper-prev"),
      swiperNext: document.getElementById("swiper-next"),
      shopView: document.getElementById("shop-view"),
      shopGrid: document.getElementById("shop-grid"),
      shopTabs: document.querySelectorAll(".shop-tab"),
      groups: {
        room: document.getElementById("actions-room"),
        shop: document.getElementById("actions-shop"),
      },
    };

    const getBounds = () => ({ width: els.stage.clientWidth, height: els.stage.clientHeight });
    sprite = new NS.Sprite(els.petEl, character, SCALE);
    pet = new NS.Pet(sprite, { say, getBounds });
    NS.attachInput(els.petEl, pet); // poke / drag / throw
    dustSprite = new NS.Sprite(els.dust, character, SCALE);

    els.reviveBtn.addEventListener("click", revive);
    els.rock.addEventListener("click", () => placeRock(els.stage.clientWidth * 0.7));
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
    els.shopTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        shopCategory = tab.dataset.category;
        els.shopTabs.forEach((t) => t.classList.toggle("active", t === tab));
        renderShop();
      });
    });

    window.addEventListener("resize", () => {
      if (currentScreen === "room") {
        pet.onResize();
        placeRock(rockX); // reclamp into the resized stage
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
    els.groups.room.classList.toggle("active", screenName === "room");
    els.groups.shop.classList.toggle("active", screenName === "shop");

    if (screenName === "room") {
      els.shopView.style.display = "none";
      els.stage.style.display = "block";
      els.swiper.style.display = "flex";
      els.itemTray.style.display = "flex";
      applyRoomVisuals();
      pet.onResize();
    } else {
      els.stage.style.display = "none";
      els.swiper.style.display = "none";
      els.itemTray.style.display = "none";
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
    placeRock(0); // left side of the stage to start

    loadStats();
    loadEconomy();
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
