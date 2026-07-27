const { test } = require("node:test");
const assert = require("node:assert/strict");
const { stepBall, GRAVITY, WALL_RESTITUTION, FLOOR_RESTITUTION, RELAUNCH_MIN, RELAUNCH_MAX } = require("./ball-physics.js");

const BOUNDS = { width: 300, height: 400, size: 40 };

test("gravity accelerates a ball downward over time when airborne", () => {
  const ball = { x: 100, y: 100, vx: 0, vy: 0 };
  stepBall(ball, 0.1, BOUNDS);
  assert.equal(ball.vy, GRAVITY * 0.1);
  assert.ok(ball.y > 100);
});

test("left wall bounce: clamps position and flips/reduces horizontal velocity", () => {
  const ball = { x: 2, y: 100, vx: -200, vy: 0 };
  stepBall(ball, 0.1, BOUNDS);
  assert.equal(ball.x, 0);
  assert.equal(ball.vx, 200 * WALL_RESTITUTION);
});

test("right wall bounce: clamps to the far edge and flips velocity leftward", () => {
  const ball = { x: BOUNDS.width - BOUNDS.size - 2, y: 100, vx: 200, vy: 0 };
  stepBall(ball, 0.1, BOUNDS);
  assert.equal(ball.x, BOUNDS.width - BOUNDS.size);
  assert.equal(ball.vx, -200 * WALL_RESTITUTION);
});

test("floor bounce: a fast-falling ball rebounds upward, scaled by restitution", () => {
  const floorY = BOUNDS.height - BOUNDS.size;
  const ball = { x: 100, y: floorY - 1, vx: 0, vy: 500 };
  stepBall(ball, 0.05, BOUNDS);
  assert.equal(ball.y, floorY);
  assert.ok(ball.vy < 0); // bounced upward
});

test("a near-dead floor bounce gets relaunched instead of settling flat", () => {
  const floorY = BOUNDS.height - BOUNDS.size;
  // Already resting on the floor with just enough downward speed to still
  // register as a floor hit; post-restitution that's well under SETTLE_THRESHOLD.
  const ball = { x: 100, y: floorY, vx: 0, vy: 50 };
  const fixedRandom = () => 0.5; // deterministic: relaunch speed = midpoint of [MIN, MAX]
  stepBall(ball, 0.01, BOUNDS, fixedRandom);
  const expected = -(RELAUNCH_MIN + 0.5 * (RELAUNCH_MAX - RELAUNCH_MIN));
  assert.equal(ball.vy, expected);
});

test("stepBall mutates and returns the same object", () => {
  const ball = { x: 10, y: 10, vx: 5, vy: 5 };
  const result = stepBall(ball, 0.016, BOUNDS);
  assert.equal(result, ball);
});
