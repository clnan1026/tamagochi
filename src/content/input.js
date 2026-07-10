(() => {
  const NS = (window.__tamagotchi ??= {});

  const DRAG_THRESHOLD = 4; // px of movement before a click becomes a drag
  const MAX_THROW_SPEED = 1200; // px/s

  const clampSpeed = (v) => Math.min(Math.max(v, -MAX_THROW_SPEED), MAX_THROW_SPEED);

  function attachInput(el, pet) {
    let pointerId = null;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    let lastX = 0;
    let last = null; // { x, y, t } sample for throw velocity

    const onPointerDown = (e) => {
      if (pointerId !== null || !e.isPrimary) return;
      // Stops the drag from selecting page text or starting a native image drag.
      e.preventDefault();

      pointerId = e.pointerId;
      el.setPointerCapture(pointerId);

      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      grabOffsetX = e.clientX - pet.x;
      grabOffsetY = e.clientY - pet.y;
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    };

    const onPointerMove = (e) => {
      if (e.pointerId !== pointerId) return;

      if (!dragging) {
        const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (moved < DRAG_THRESHOLD) return;
        dragging = true;
        pet.grab();
      }

      pet.dragTo(e.clientX - grabOffsetX, e.clientY - grabOffsetY, e.clientX - lastX);
      lastX = e.clientX;
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    };

    const onPointerUp = (e) => {
      if (e.pointerId !== pointerId) return;
      el.releasePointerCapture(pointerId);
      pointerId = null;

      if (!dragging) {
        pet.poke();
        return;
      }

      // Velocity over the final pointer segment; a stale sample means "dropped".
      const dt = (e.timeStamp - last.t) / 1000;
      const vx = dt > 0 && dt < 0.1 ? clampSpeed((e.clientX - last.x) / dt) : 0;
      const vy = dt > 0 && dt < 0.1 ? clampSpeed((e.clientY - last.y) / dt) : 0;
      pet.release(vx, vy);
    };

    const onPointerCancel = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (dragging) pet.release(0, 0);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("dragstart", (e) => e.preventDefault());
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  NS.attachInput = attachInput;
})();
