(() => {
  const NS = (window.__tamagotchi ??= {});

  const GRAVITY = 2200; // px/s^2
  const WALK_SPEED = 60; // px/s
  const RUN_SPEED = 150;
  const JUMP_VELOCITY = -700;
  const ARRIVE_EPSILON = 3; // px; closer than this counts as "at target"
  const THROW_DAMPING = 0.35; // drags are fast; don't fling the pet across the page

  const POKE_PHRASES = {
    en : ["Ouch! 💢", "Stop it~ 😂", "Hey! That tickles!", "Go away!", "Hmph!", "hehe~"],
    ja: ["やめてよ〜 💢", "ひぃ！ 😂", "やめて😒", "ちょっと！", "つんつん..", "やめて〜"], 
    ko: ["아야! 💢", "하지 마~ 😂", "앗! 간지러워!", "저리 가!", "치이.."]
  };
  const randomBetween = (min, max) => min + Math.random() * (max - min);

  class Pet {
    // `say` renders a speech bubble; supplied by the host.
    // `getBounds` returns the roaming area {width, height}; defaults to the window
    // (extension + desktop overlay) but the app's pet room passes its stage size.
    constructor(sprite, { say, getBounds } = {}) {
      this.sprite = sprite;
      this.say = say;
      this.getBounds = getBounds || (() => ({ width: window.innerWidth, height: window.innerHeight }));

      this.lang = "ja";
      this.speedScale = 1; // room lowers this when battery/stamina is low

      this.x = randomBetween(0, this.maxX());
      this.y = this.groundY();
      this.vx = 0;
      this.vy = 0;

      this.state = "idle";
      this.timer = 0;
      this.targetX = this.x;

      this.sprite.play("idle");
    }

    groundY() {
      return this.getBounds().height - this.sprite.size;
    }

    maxX() {
      return Math.max(0, this.getBounds().width - this.sprite.size);
    }

    update(dt) {
      switch (this.state) {
        case "idle":
          this.#updateIdle(dt);
          break;
        case "walk":
        case "run":
          this.#updateTravel(dt);
          break;
        case "air":
          this.#updateAir(dt);
          break;
        case "hurt":
        case "react": // one-shot reaction (eat / playful / idle flourish)
          this.vx = 0;
          break;
        case "dead":
          this.vx = 0; // fainted; holds the last death frame until revive()
          break;
        case "drag":
          // Position is driven by the pointer; no physics.
          break;
      }

      if (this.state !== "drag") {
        this.x = Math.min(Math.max(this.x, 0), this.maxX());
      }
      this.sprite.tick(dt);
      this.sprite.render(this.x, this.y);
    }

    #updateIdle(dt) {
      this.vx = 0;
      this.timer -= dt;
      if (this.timer > 0) return;

      const roll = Math.random();
      if (roll < 0.1) {
        this.#jump();
      } else if (roll < 0.2) {
        // A little personality: an occasional throw or combo flourish, then rest.
        this.#react(Math.random() < 0.5 ? "throw" : "attack2");
      } else {
        this.targetX = randomBetween(0, this.maxX());
        const running = roll > 0.9;
        this.state = running ? "run" : "walk";
        this.sprite.play(running ? "run" : "walk");
      }
    }

    // A grounded one-shot animation that returns to idle when it finishes.
    #react(anim) {
      if (this.state === "drag" || this.state === "air" || this.state === "dead") return;
      this.state = "react";
      this.vx = 0;
      this.vy = 0;
      this.y = this.groundY();
      this.sprite.play(anim, () => this.#rest(), true);
    }

    #updateTravel(dt) {
      const speed = (this.state === "run" ? RUN_SPEED : WALK_SPEED) * this.speedScale;
      const delta = this.targetX - this.x;

      if (Math.abs(delta) < ARRIVE_EPSILON || this.#atWall(delta)) {
        this.#rest();
        return;
      }

      const direction = Math.sign(delta);
      this.sprite.face(direction);
      this.vx = direction * speed;
      this.x += this.vx * dt;
    }

    #atWall(delta) {
      return (this.x <= 0 && delta < 0) || (this.x >= this.maxX() && delta > 0);
    }

    #updateAir(dt) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt;

      // Bounce off the side walls instead of sticking to them.
      if ((this.x <= 0 && this.vx < 0) || (this.x >= this.maxX() && this.vx > 0)) {
        this.vx *= -0.5;
        this.sprite.face(this.vx);
      }

      const ground = this.groundY();
      if (this.y >= ground && this.vy >= 0) {
        this.y = ground;
        this.vy = 0;
        this.vx = 0;
        this.#rest();
      }
    }

    #rest() {
      this.state = "idle";
      this.timer = randomBetween(0.8, 3);
      this.vx = 0;
      this.sprite.play("idle");
    }

    #jump() {
      this.state = "air";
      this.vy = JUMP_VELOCITY;
      this.vx = randomBetween(-40, 40);
      this.sprite.face(this.vx || this.sprite.facing);
      this.sprite.play("jump");
    }
    
    setLanguage(lang) {
      this.lang = lang;
    }

    // Feed reaction: a chomp. Play reaction: a jump or a combo flourish, or a
    // specific one if `force` is given (e.g. a toy that always does the same trick).
    eat() {
      this.#react("attack1");
    }
    playful(force = null) {
      if (this.state === "drag" || this.state === "dead") return;
      if (force === "jump") this.#jump();
      else if (force === "attack2") this.#react("attack2");
      else if (Math.random() < 0.5) this.#jump();
      else this.#react("attack2");
    }

    // Faint when HP hits 0: play the death animation once and lock until revived.
    die() {
      if (this.state === "dead") return;
      this.state = "dead";
      this.vx = 0;
      this.vy = 0;
      this.y = this.groundY();
      this.sprite.play("death", null, true);
    }
    revive() {
      this.state = "idle";
      this.timer = randomBetween(0.8, 3);
      this.vx = 0;
      this.sprite.play("idle", null, true);
    }

    poke() {
      if (this.state === "drag" || this.state === "dead") return;
      this.state = "hurt";
      this.vx = 0;
      this.vy = 0;
      this.y = this.groundY();
      this.sprite.play("hurt", () => this.#rest(), true);
      
      const phrases = POKE_PHRASES[this.lang] || POKE_PHRASES["ja"];
      
      this.say(phrases[Math.floor(Math.random() * phrases.length)]);
    }

    grab() {
      if (this.state === "dead") return; // fainted pets lie still until revive()
      this.state = "drag";
      this.vx = 0;
      this.vy = 0;
      this.sprite.play("jump");
    }

    dragTo(x, y, dx) {
      // input.js tracks dragging independent of pet.state; if grab() refused
      // (e.g. the pet fainted mid-drag) there's nothing to move.
      if (this.state !== "drag") return;
      this.x = Math.min(Math.max(x, 0), this.maxX());
      this.y = Math.min(Math.max(y, 0), this.groundY());
      if (Math.abs(dx) > 0.5) this.sprite.face(dx);
    }

    // `vx`/`vy` are the pointer's recent velocity, so a flick throws the pet.
    release(vx, vy) {
      if (this.state !== "drag") return; // same rationale as dragTo()
      this.state = "air";
      this.vx = vx * THROW_DAMPING;
      this.vy = vy * THROW_DAMPING;
      this.sprite.play("jump", null, true);
    }

    onResize() {
      this.x = Math.min(this.x, this.maxX());
      const ground = this.groundY();
      if (this.state !== "air" && this.state !== "drag") {
        this.y = ground;
      } else if (this.y > ground) {
        this.y = ground;
        if (this.state === "air") this.#rest();
      }
    }
  }

  NS.Pet = Pet;
})();
