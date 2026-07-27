const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PetStats } = require("./stats.js");

test("a fresh pet (no saved snapshot) starts at full HP/satiety", () => {
  const s = new PetStats(null);
  assert.equal(s.hp, 100);
  assert.equal(s.satiety, 100);
});

test("PetStats is agnostic to storage — it only cares about the snapshot shape it's given, never a key name", () => {
  // room.js namespaces the localStorage key per character (tama-stats:${character}),
  // but PetStats itself has no concept of "which character" — it just restores
  // whatever snapshot it's handed. This is what makes per-character stats safe:
  // switching characters is purely a room.js-level concern of which snapshot to load.
  const snapshotA = new PetStats(null).snapshot();
  const restored = new PetStats(snapshotA);
  assert.equal(restored.hp, 100);
  assert.equal(restored.satiety, 100);
});

test("starving drains HP; well-fed regenerates it", () => {
  const s = new PetStats(null);
  s.satiety = 0;
  s.tick(60); // 60s starving
  assert.ok(s.hp < 100);

  s.hp = 50;
  s.satiety = 100;
  s.tick(60);
  assert.ok(s.hp > 50);
});

test("feed/play accept an override amount (the dragged item's actual value)", () => {
  const s = new PetStats(null);
  s.satiety = 0;
  s.feed(35); // e.g. Tasty Treat's satiety value, not the default kibble amount
  assert.equal(s.satiety, 35);
  s.play(8); // e.g. Yo-yo's satietyCost
  assert.equal(s.satiety, 27);
});

test("reset() revives with full HP and a partial satiety head start", () => {
  const s = new PetStats(null);
  s.hp = 0;
  s.satiety = 0;
  s.reset();
  assert.equal(s.hp, 100);
  assert.equal(s.satiety, 60);
});

test("offline decay is capped so a long absence can't wipe stats to an extreme instantly", () => {
  const now = Date.now();
  const longAgo = now - 999 * 3600 * 1000; // absurdly long absence
  const s = new PetStats({ hp: 100, satiety: 100, lastSeen: longAgo }, now);
  assert.ok(s.hp >= 0 && s.hp <= 100);
  assert.ok(s.satiety >= 0 && s.satiety <= 100);
});
