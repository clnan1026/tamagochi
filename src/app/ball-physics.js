// Pure ball-bounce physics step for the Game Room's shelf/bounce feature — no DOM,
// so it's runnable in Node for tests as well as loaded as a plain <script> in the
// app. `ball` is a plain { x, y, vx, vy } object (mutated and returned in place);
// `bounds` is { width, height, size } describing the stage and the ball's own
// square footprint.
(() => {
  const GRAVITY = 900; // px/s^2
  const WALL_RESTITUTION = 0.85;
  const FLOOR_RESTITUTION = 0.72;
  const SETTLE_THRESHOLD = 80; // px/s — below this on a floor bounce, re-launch instead of settling dead
  const RELAUNCH_MIN = 150;
  const RELAUNCH_MAX = 350;

  function stepBall(ball, dt, bounds, random = Math.random) {
    const floorY = bounds.height - bounds.size;

    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x <= 0) {
      ball.x = 0;
      ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    } else if (ball.x >= bounds.width - bounds.size) {
      ball.x = bounds.width - bounds.size;
      ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    }

    if (ball.y >= floorY) {
      ball.y = floorY;
      ball.vy = -ball.vy * FLOOR_RESTITUTION;
      if (Math.abs(ball.vy) < SETTLE_THRESHOLD) {
        ball.vy = -(RELAUNCH_MIN + random() * (RELAUNCH_MAX - RELAUNCH_MIN));
      }
    } else if (ball.y < 0) {
      ball.y = 0;
      ball.vy = Math.abs(ball.vy) * FLOOR_RESTITUTION;
    }

    return ball;
  }

  const api = {
    stepBall,
    GRAVITY,
    WALL_RESTITUTION,
    FLOOR_RESTITUTION,
    SETTLE_THRESHOLD,
    RELAUNCH_MIN,
    RELAUNCH_MAX,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    (window.__tamagotchi ??= {}).BallPhysics = api;
  }
})();
