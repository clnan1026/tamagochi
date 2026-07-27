// Economy — coins, consumable food, one-time toy/room unlocks, and which room the
// player is currently in. Host-agnostic: no DOM, no chrome.*, no Electron. Runnable
// in Node for tests and loaded as a plain <script> in the app.
//
// No "equipped" food/toy concept: using an item means dragging that specific owned
// item onto the pet (see room.js), so the item dragged *is* the choice each time.
(() => {
  // Rooms carry a `type` — "kitchen" shows the food tray, "field" shows the toy
  // tray, matching Pou's actual room/tray split. Backgrounds are either a real
  // image (the two original free fields) or a named CSS gradient theme — there is
  // no extra scenery art in this project, so purchased rooms are gradient themes.
  const CATALOG = {
    foods: {
      kibble: { id: "kibble", emoji: "🍖", price: 0, satiety: 25, names: { en: "Basic Kibble", ja: "ベーシックフード", ko: "기본 사료" } },
      treat: { id: "treat", emoji: "🍎", price: 20, satiety: 35, names: { en: "Tasty Treat", ja: "おいしいおやつ", ko: "맛있는 간식" } },
      meal: { id: "meal", emoji: "🍗", price: 45, satiety: 55, names: { en: "Hearty Meal", ja: "がっつりごはん", ko: "든든한 식사" } },
      feast: { id: "feast", emoji: "🍰", price: 90, satiety: 85, names: { en: "Feast", ja: "ごちそう", ko: "진수성찬" } },
    },
    toys: {
      ball: { id: "ball", emoji: "🎾", price: 0, forceAnim: null, satietyCost: 10, coinReward: 3, names: { en: "Ball", ja: "ボール", ko: "공" } },
      yoyo: { id: "yoyo", emoji: "🪀", price: 60, forceAnim: "attack2", satietyCost: 8, coinReward: 5, names: { en: "Yo-yo", ja: "ヨーヨー", ko: "요요" } },
      kite: { id: "kite", emoji: "🪁", price: 120, forceAnim: "jump", satietyCost: 6, coinReward: 7, names: { en: "Kite", ja: "たこ", ko: "연" } },
    },
    rooms: {
      basic: { id: "basic", price: 0, type: "field", background: { kind: "image", value: "bg_basic.jpg" }, names: { en: "Basic Field", ja: "基本フィールド", ko: "일반 필드" } },
      game: { id: "game", price: 0, type: "field", background: { kind: "image", value: "bg_game.png" }, names: { en: "Game Field", ja: "ゲームフィールド", ko: "게임 필드" } },
      kitchen: { id: "kitchen", price: 0, type: "kitchen", background: { kind: "gradient", value: "kitchen" }, names: { en: "Kitchen", ja: "キッチン", ko: "주방" } },
      sunset: { id: "sunset", price: 100, type: "field", background: { kind: "gradient", value: "sunset" }, names: { en: "Sunset Room", ja: "サンセットルーム", ko: "노을 방" } },
      midnight: { id: "midnight", price: 150, type: "field", background: { kind: "gradient", value: "midnight" }, names: { en: "Midnight Room", ja: "ミッドナイトルーム", ko: "한밤 방" } },
      candy: { id: "candy", price: 150, type: "field", background: { kind: "gradient", value: "candy" }, names: { en: "Candy Room", ja: "キャンディルーム", ko: "캔디 방" } },
    },
  };

  const FREE_FOOD_ID = "kibble";
  const DEFAULT_TOY_ID = "ball";
  const DEFAULT_ROOMS = ["basic", "game", "kitchen"];
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

  class Economy {
    // `saved` is a persisted snapshot (see snapshot()) or null.
    constructor(saved = null) {
      this.coins = Number.isFinite(saved?.coins) && saved.coins > 0 ? Math.floor(saved.coins) : 0;
      this.foodCounts = sanitizeFoodCounts(saved?.foodCounts);
      this.ownedToys = sanitizeIds(saved?.ownedToys, CATALOG.toys, [DEFAULT_TOY_ID]);
      this.ownedRooms = sanitizeIds(saved?.ownedRooms, CATALOG.rooms, DEFAULT_ROOMS);
      this.currentRoomId =
        typeof saved?.currentRoomId === "string" && this.ownedRooms.includes(saved.currentRoomId)
          ? saved.currentRoomId
          : "basic";
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

    buyRoom(id) {
      const item = CATALOG.rooms[id];
      if (!item || this.ownedRooms.includes(id)) return false;
      if (item.price > 0 && !this.canAfford(item.price)) return false;
      if (item.price > 0) this.coins -= item.price;
      this.ownedRooms.push(id);
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
    // this is exactly what the drag-tray renders in a Kitchen room.
    ownedFoodList() {
      const list = [{ ...CATALOG.foods[FREE_FOOD_ID], quantity: Infinity }];
      for (const [id, qty] of Object.entries(this.foodCounts)) {
        if (qty > 0 && CATALOG.foods[id]) list.push({ ...CATALOG.foods[id], quantity: qty });
      }
      return list;
    }

    // What the drag-tray renders in a Field room.
    ownedToyList() {
      return this.ownedToys.map((id) => CATALOG.toys[id]).filter(Boolean);
    }

    // Free rooms first (basic, game, kitchen, in that fixed order), then purchased
    // rooms in the order they were bought — what the field-swiper cycles through.
    roomList() {
      return this.ownedRooms.map((id) => CATALOG.rooms[id]).filter(Boolean);
    }

    setCurrentRoom(id) {
      if (this.ownedRooms.includes(id)) this.currentRoomId = id;
    }

    snapshot() {
      return {
        coins: this.coins,
        foodCounts: { ...this.foodCounts },
        ownedToys: [...this.ownedToys],
        ownedRooms: [...this.ownedRooms],
        currentRoomId: this.currentRoomId,
      };
    }
  }

  Economy.CATALOG = CATALOG;
  Economy.FREE_FOOD_ID = FREE_FOOD_ID;
  Economy.DEFAULT_TOY_ID = DEFAULT_TOY_ID;
  Economy.DEFAULT_ROOMS = DEFAULT_ROOMS;
  Economy.FEED_COIN_REWARD = FEED_COIN_REWARD;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Economy };
  } else {
    (window.__tamagotchi ??= {}).Economy = Economy;
  }
})();
