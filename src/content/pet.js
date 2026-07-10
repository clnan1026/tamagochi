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
    // `say` renders a speech bubble; supplied by the overlay.
    constructor(sprite, { say }) {
      this.sprite = sprite;
      this.say = say;

      this.lang = "ja";

      this.x = randomBetween(0, Math.max(0, window.innerWidth - sprite.size));
      this.y = this.groundY();
      this.vx = 0;
      this.vy = 0;

      this.state = "idle";
      this.timer = 0;
      this.targetX = this.x;

      this.sprite.play("idle");
    }

    groundY() {
      return window.innerHeight - this.sprite.size;
    }

    maxX() {
      return Math.max(0, window.innerWidth - this.sprite.size);
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
          this.vx = 0;
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
      if (roll < 0.15) {
        this.#jump();
      } else {
        this.targetX = randomBetween(0, this.maxX());
        const running = roll > 0.85;
        this.state = running ? "run" : "walk";
        this.sprite.play(running ? "run" : "walk");
      }
    }

    #updateTravel(dt) {
      const speed = this.state === "run" ? RUN_SPEED : WALK_SPEED;
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

    poke() {
      if (this.state === "drag") return;
      this.state = "hurt";
      this.vx = 0;
      this.vy = 0;
      this.y = this.groundY();
      this.sprite.play("hurt", () => this.#rest(), true);
      
      const phrases = POKE_PHRASES[this.lang] || POKE_PHRASES["ja"];
      
      this.say(phrases[Math.floor(Math.random() * phrases.length)]);
    }

    grab() {
      this.state = "drag";
      this.vx = 0;
      this.vy = 0;
      this.sprite.play("jump");
    }

    dragTo(x, y, dx) {
      this.x = Math.min(Math.max(x, 0), this.maxX());
      this.y = Math.min(Math.max(y, 0), this.groundY());
      if (Math.abs(dx) > 0.5) this.sprite.face(dx);
    }

    // `vx`/`vy` are the pointer's recent velocity, so a flick throws the pet.
    release(vx, vy) {
      this.state = "air";
      this.vx = vx * THROW_DAMPING;
      this.vy = vy * THROW_DAMPING;
      this.sprite.play("jump", null, true);
    }

    onResize() {
      this.x = Math.min(this.x, this.maxX());
      const ground = this.groundY();
      if (this.y > ground) {
        this.y = ground;
        if (this.state === "air") this.#rest();
      }
    }
  }

  NS.Pet = Pet;
})();
