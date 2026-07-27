// Economy — coins, consumable food (by category), one-time ball unlocks, and
// per-room purchasable background choices. Host-agnostic: no DOM, no chrome.*,
// no Electron. Runnable in Node for tests and loaded as a plain <script> in the app.
//
// No "equipped" food/toy concept: using an item means dragging that specific owned
// item onto the pet (see room.js), so the item dragged *is* the choice each time.
// Rooms themselves (Kitchen/Game Room/Bedroom) are fixed and always free — only a
// room's optional background picture is purchasable, per-room.
(() => {
  const CATALOG = {
    foods: {
      // meals 🍗 — kibble is always free/∞
      kibble:    { id: "kibble",    category: "meals", emoji: "🍖", price: 0,  satiety: 25, names: { en: "Basic Kibble", ja: "ベーシックフード", ko: "기본 사료" } },
      rice_ball: { id: "rice_ball", category: "meals", emoji: "🍙", price: 15, satiety: 30, names: { en: "Rice Ball", ja: "おにぎり", ko: "주먹밥" } },
      sandwich:  { id: "sandwich",  category: "meals", emoji: "🥪", price: 30, satiety: 38, names: { en: "Sandwich", ja: "サンドイッチ", ko: "샌드위치" } },
      meal:      { id: "meal",      category: "meals", emoji: "🍗", price: 45, satiety: 55, names: { en: "Hearty Meal", ja: "がっつりごはん", ko: "든든한 식사" } },
      pizza:     { id: "pizza",     category: "meals", emoji: "🍕", price: 75, satiety: 68, names: { en: "Pizza Slice", ja: "ピザ", ko: "피자" } },
      feast:     { id: "feast",     category: "meals", emoji: "🍱", price: 90, satiety: 85, names: { en: "Feast", ja: "ごちそう", ko: "진수성찬" } },

      // sweets 🍰
      treat:      { id: "treat",      category: "sweets", emoji: "🍎", price: 20,  satiety: 35, names: { en: "Tasty Treat", ja: "おいしいおやつ", ko: "맛있는 간식" } },
      cookie:     { id: "cookie",     category: "sweets", emoji: "🍪", price: 35,  satiety: 40, names: { en: "Cookie", ja: "クッキー", ko: "쿠키" } },
      donut:      { id: "donut",      category: "sweets", emoji: "🍩", price: 50,  satiety: 45, names: { en: "Donut", ja: "ドーナツ", ko: "도넛" } },
      cupcake:    { id: "cupcake",    category: "sweets", emoji: "🧁", price: 65,  satiety: 55, names: { en: "Cupcake", ja: "カップケーキ", ko: "컵케이크" } },
      cake_slice: { id: "cake_slice", category: "sweets", emoji: "🍰", price: 80,  satiety: 65, names: { en: "Cake Slice", ja: "ケーキ", ko: "케이크" } },
      ice_cream:  { id: "ice_cream",  category: "sweets", emoji: "🍨", price: 110, satiety: 75, names: { en: "Ice Cream", ja: "アイスクリーム", ko: "아이스크림" } },

      // drinks 🥤
      water:      { id: "water",      category: "drinks", emoji: "💧", price: 10,  satiety: 12, names: { en: "Water", ja: "お水", ko: "물" } },
      soda:       { id: "soda",       category: "drinks", emoji: "🥤", price: 25,  satiety: 18, names: { en: "Soda", ja: "ソーダ", ko: "탄산음료" } },
      juice:      { id: "juice",      category: "drinks", emoji: "🧃", price: 40,  satiety: 24, names: { en: "Juice", ja: "ジュース", ko: "주스" } },
      milk:       { id: "milk",       category: "drinks", emoji: "🥛", price: 55,  satiety: 30, names: { en: "Milk", ja: "ミルク", ko: "우유" } },
      smoothie:   { id: "smoothie",   category: "drinks", emoji: "🍹", price: 75,  satiety: 40, names: { en: "Smoothie", ja: "スムージー", ko: "스무디" } },
      bubble_tea: { id: "bubble_tea", category: "drinks", emoji: "🧋", price: 100, satiety: 50, names: { en: "Bubble Tea", ja: "タピオカ", ko: "버블티" } },
    },
    // Kept as "toys" internally (id/shape reuse for old saves) — shop-facing copy calls these "Balls".
    toys: {
      ball:       { id: "ball",       emoji: "🎾", price: 0,   forceAnim: null,      satietyCost: 10, coinReward: 3,  names: { en: "Ball", ja: "ボール", ko: "공" } },
      yoyo:       { id: "yoyo",       emoji: "🪀", price: 60,  forceAnim: "attack2", satietyCost: 8,  coinReward: 5,  names: { en: "Yo-yo", ja: "ヨーヨー", ko: "요요" } },
      kite:       { id: "kite",       emoji: "🪁", price: 120, forceAnim: "jump",    satietyCost: 6,  coinReward: 7,  names: { en: "Kite", ja: "たこ", ko: "연" } },
      beach_ball: { id: "beach_ball", emoji: "🏖️", price: 25,  forceAnim: null,      satietyCost: 9,  coinReward: 4,  names: { en: "Beach Ball", ja: "ビーチボール", ko: "비치볼" } },
      basketball: { id: "basketball", emoji: "🏀", price: 50,  forceAnim: "attack2", satietyCost: 8,  coinReward: 6,  names: { en: "Basketball", ja: "バスケットボール", ko: "농구공" } },
      disco_ball: { id: "disco_ball", emoji: "🪩", price: 150, forceAnim: "attack2", satietyCost: 5,  coinReward: 12, names: { en: "Disco Ball", ja: "ディスコボール", ko: "디스코볼" } },
    },
    // 2 purchasable alternate backgrounds per room, on top of that room's free
    // default solid color (see room.js's ROOMS map). Placeholder art — the user
    // will replace assets/backgrounds/*.png themselves later.
    backgrounds: {
      kitchen: [
        { id: "kitchen_bg1", price: 80, image: "backgrounds/kitchen_bg1.png" },
        { id: "kitchen_bg2", price: 140, image: "backgrounds/kitchen_bg2.png" },
      ],
      gameroom: [
        { id: "gameroom_bg1", price: 80, image: "backgrounds/gameroom_bg1.png" },
        { id: "gameroom_bg2", price: 140, image: "backgrounds/gameroom_bg2.png" },
      ],
      bedroom: [
        { id: "bedroom_bg1", price: 80, image: "backgrounds/bedroom_bg1.png" },
        { id: "bedroom_bg2", price: 140, image: "backgrounds/bedroom_bg2.png" },
      ],
    },
  };

  const FREE_FOOD_ID = "kibble";
  const DEFAULT_TOY_ID = "ball";
  const ROOM_IDS = ["kitchen", "gameroom", "bedroom"];
  const FOOD_CATEGORIES = ["drinks", "sweets", "meals"];
  const FEED_COIN_REWARD = 2;

  function sanitizeIds(arr, catalog, defaults) {
    const set = new Set(defaults);
    if (Array.isArray(arr)) for (const id of arr) if (catalog[id]) set.add(id);
    return [...set];
  }

  function sanitizeFoodCounts(obj) {
    const clean = {};
    if (obj && typeof obj === "object") {
      for (const [id, qty] of Object.entries(obj)) {
        if (id !== FREE_FOOD_ID && CATALOG.foods[id] && Number.isFinite(qty) && qty > 0) {
          clean[id] = Math.floor(qty);
        }
      }
    }
    return clean;
  }

  // Per-room owned/current background maps share this shape: { kitchen: [...], gameroom: [...], bedroom: [...] }.
  function sanitizeBackgroundOwnership(obj) {
    const clean = {};
    for (const roomId of ROOM_IDS) {
      const catalog = CATALOG.backgrounds[roomId];
      const owned = obj && Array.isArray(obj[roomId]) ? obj[roomId] : [];
      clean[roomId] = owned.filter((id) => catalog.some((bg) => bg.id === id));
    }
    return clean;
  }

  function sanitizeCurrentBackground(obj, ownedBackgrounds) {
    const clean = {};
    for (const roomId of ROOM_IDS) {
      const id = obj?.[roomId];
      clean[roomId] = typeof id === "string" && ownedBackgrounds[roomId].includes(id) ? id : null;
    }
    return clean;
  }

  class Economy {
    // `saved` is a persisted snapshot (see snapshot()) or null.
    constructor(saved = null) {
      this.coins = Number.isFinite(saved?.coins) && saved.coins > 0 ? Math.floor(saved.coins) : 0;
      this.foodCounts = sanitizeFoodCounts(saved?.foodCounts);
      this.ownedToys = sanitizeIds(saved?.ownedToys, CATALOG.toys, [DEFAULT_TOY_ID]);

      this.ownedBackgrounds = sanitizeBackgroundOwnership(saved?.ownedBackgrounds);
      this.currentBackgroundId = sanitizeCurrentBackground(saved?.currentBackgroundId, this.ownedBackgrounds);

      this.currentRoomId = ROOM_IDS.includes(saved?.currentRoomId) ? saved.currentRoomId : "kitchen";
    }

    addCoins(n) {
      this.coins = Math.max(0, this.coins + Math.round(n));
    }

    canAfford(price) {
      return this.coins >= price;
    }

    // Each buy* returns true on success, false if already owned/unaffordable/unknown.
    buyFood(id) {
      const item = CATALOG.foods[id];
      if (!item || item.price === 0 || !this.canAfford(item.price)) return false;
      this.coins -= item.price;
      this.foodCounts[id] = (this.foodCounts[id] || 0) + 1;
      return true;
    }

    buyToy(id) {
      const item = CATALOG.toys[id];
      if (!item || this.ownedToys.includes(id)) return false;
      if (item.price > 0 && !this.canAfford(item.price)) return false;
      if (item.price > 0) this.coins -= item.price;
      this.ownedToys.push(id);
      return true;
    }

    // Buying a background equips it immediately (matches how food/toys are
    // instantly usable on purchase). Re-tapping an already-owned one just
    // re-equips it for free via setCurrentBackground.
    buyBackground(roomId, id) {
      const list = CATALOG.backgrounds[roomId];
      if (!list) return false;
      const item = list.find((bg) => bg.id === id);
      if (!item || this.ownedBackgrounds[roomId].includes(id)) return false;
      if (!this.canAfford(item.price)) return false;
      this.coins -= item.price;
      this.ownedBackgrounds[roomId].push(id);
      this.currentBackgroundId[roomId] = id;
      return true;
    }

    // `id` may be null to switch back to the room's free default solid color.
    setCurrentBackground(roomId, id) {
      if (!ROOM_IDS.includes(roomId)) return false;
      if (id !== null && !this.ownedBackgrounds[roomId].includes(id)) return false;
      this.currentBackgroundId[roomId] = id;
      return true;
    }

    // Infinity for the always-free Basic Kibble; owned quantity for everything else.
    foodQuantity(id) {
      return id === FREE_FOOD_ID ? Infinity : this.foodCounts[id] || 0;
    }

    // Consumes one unit; false (and no-op) if none owned. Free Kibble never depletes.
    consumeFood(id) {
      if (id === FREE_FOOD_ID) return true;
      if ((this.foodCounts[id] || 0) <= 0) return false;
      this.foodCounts[id] -= 1;
      return true;
    }

    // Basic Kibble first (always present), then any owned paid food with qty > 0 —
    // this is exactly what the drag-tray renders in the Kitchen.
    ownedFoodList() {
      const list = [{ ...CATALOG.foods[FREE_FOOD_ID], quantity: Infinity }];
      for (const [id, qty] of Object.entries(this.foodCounts)) {
        if (qty > 0 && CATALOG.foods[id]) list.push({ ...CATALOG.foods[id], quantity: qty });
      }
      return list;
    }

    // What the ball shelf renders in the Game Room.
    ownedToyList() {
      return this.ownedToys.map((id) => CATALOG.toys[id]).filter(Boolean);
    }

    setCurrentRoom(id) {
      if (ROOM_IDS.includes(id)) this.currentRoomId = id;
    }

    snapshot() {
      return {
        coins: this.coins,
        foodCounts: { ...this.foodCounts },
        ownedToys: [...this.ownedToys],
        ownedBackgrounds: {
          kitchen: [...this.ownedBackgrounds.kitchen],
          gameroom: [...this.ownedBackgrounds.gameroom],
          bedroom: [...this.ownedBackgrounds.bedroom],
        },
        currentBackgroundId: { ...this.currentBackgroundId },
        currentRoomId: this.currentRoomId,
      };
    }
  }

  Economy.CATALOG = CATALOG;
  Economy.FREE_FOOD_ID = FREE_FOOD_ID;
  Economy.DEFAULT_TOY_ID = DEFAULT_TOY_ID;
  Economy.ROOM_IDS = ROOM_IDS;
  Economy.FOOD_CATEGORIES = FOOD_CATEGORIES;
  Economy.FEED_COIN_REWARD = FEED_COIN_REWARD;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Economy };
  } else {
    (window.__tamagotchi ??= {}).Economy = Economy;
  }
})();
