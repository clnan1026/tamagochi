const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Economy } = require("./economy.js");

test("defaults for a brand-new economy", () => {
  const e = new Economy();
  assert.equal(e.coins, 0);
  assert.deepEqual(e.foodCounts, {});
  assert.deepEqual(e.ownedToys, ["ball"]);
  assert.deepEqual(e.ownedBackgrounds, { kitchen: [], gameroom: [], bedroom: [] });
  assert.deepEqual(e.currentBackgroundId, { kitchen: null, gameroom: null, bedroom: null });
  assert.equal(e.currentRoomId, "kitchen");
});

test("addCoins/canAfford", () => {
  const e = new Economy();
  e.addCoins(50);
  assert.equal(e.coins, 50);
  assert.equal(e.canAfford(50), true);
  assert.equal(e.canAfford(51), false);
  e.addCoins(-1000); // never goes negative
  assert.equal(e.coins, 0);
});

test("buyFood: free kibble can't be 'bought'; paid food deducts and stacks", () => {
  const e = new Economy();
  assert.equal(e.buyFood("kibble"), false); // price 0 — not purchasable
  assert.equal(e.buyFood("treat"), false); // can't afford (0 coins)
  e.addCoins(100);
  assert.equal(e.buyFood("treat"), true);
  assert.equal(e.coins, 80);
  assert.equal(e.foodCounts.treat, 1);
  assert.equal(e.buyFood("treat"), true); // stacks, doesn't replace
  assert.equal(e.foodCounts.treat, 2);
});

test("buyToy: one-time unlock, no double charge", () => {
  const e = new Economy();
  e.addCoins(1000);
  assert.equal(e.buyToy("yoyo"), true);
  assert.equal(e.coins, 940);
  assert.equal(e.buyToy("yoyo"), false); // already owned
  assert.equal(e.coins, 940); // not charged again
  assert.equal(e.buyToy("ball"), false); // already owned by default
});

test("buyBackground: buy-and-equip, re-equip without repaying, can't double-buy", () => {
  const e = new Economy();
  e.addCoins(200);
  assert.equal(e.buyBackground("kitchen", "kitchen_bg1"), true);
  assert.equal(e.coins, 120);
  assert.equal(e.currentBackgroundId.kitchen, "kitchen_bg1");
  assert.ok(e.ownedBackgrounds.kitchen.includes("kitchen_bg1"));

  assert.equal(e.buyBackground("kitchen", "kitchen_bg1"), false); // already owned
  assert.equal(e.coins, 120); // not charged again

  assert.equal(e.setCurrentBackground("kitchen", null), true); // back to default
  assert.equal(e.currentBackgroundId.kitchen, null);
  assert.equal(e.setCurrentBackground("kitchen", "kitchen_bg1"), true); // re-equip, free
  assert.equal(e.currentBackgroundId.kitchen, "kitchen_bg1");

  assert.equal(e.setCurrentBackground("kitchen", "kitchen_bg2"), false); // not owned yet
  assert.equal(e.buyBackground("kitchen", "kitchen_bg2"), false); // can't afford (only 120 left, costs 140)
});

test("snapshot/restore round-trips", () => {
  const e = new Economy();
  e.addCoins(500);
  e.buyFood("treat");
  e.buyToy("kite");
  e.buyBackground("gameroom", "gameroom_bg1");
  e.setCurrentRoom("bedroom");

  const restored = new Economy(e.snapshot());
  assert.deepEqual(restored.snapshot(), e.snapshot());
});

test("sanitizes an old-shaped or corrupted snapshot without throwing", () => {
  const stale = {
    coins: -5, // corrupted: negative
    foodCounts: { treat: 2, unknown_food: 3, kibble: 9 }, // kibble shouldn't be counted; unknown dropped
    ownedToys: ["ball", "yoyo", "not_a_real_toy"],
    ownedRooms: ["basic", "game", "sunset"], // field no longer exists on Economy at all
    currentRoomId: "basic", // no longer a valid room id
  };
  const e = new Economy(stale);
  assert.equal(e.coins, 0);
  assert.deepEqual(e.foodCounts, { treat: 2 });
  assert.deepEqual(new Set(e.ownedToys), new Set(["ball", "yoyo"]));
  assert.equal(e.currentRoomId, "kitchen"); // falls back to the default
});
