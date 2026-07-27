(() => {
  const NS = (window.__tamagotchi ??= {});

  // Every sheet in the pack is a horizontal strip of 32x32 frames.
  const FRAME_SIZE = 32;

  const CHARACTERS = ["pink", "owlet", "dude"];

  const ANIMATIONS = {
    idle: { frames: 4, fps: 6, loop: true },
    walk: { frames: 6, fps: 10, loop: true },
    run: { frames: 6, fps: 14, loop: true },
    jump: { frames: 8, fps: 12, loop: false },
    hurt: { frames: 4, fps: 8, loop: false },
    climb: { frames: 4, fps: 8, loop: true },
    attack1: { frames: 4, fps: 12, loop: false }, // feed chomp
    attack2: { frames: 6, fps: 12, loop: false }, // play combo / flourish
    death: { frames: 8, fps: 8, loop: false }, // faint (holds last frame)
    push: { frames: 6, fps: 10, loop: true }, // shoving the rock
    throw: { frames: 4, fps: 12, loop: false }, // idle flourish
    walkattack: { frames: 6, fps: 10, loop: true },
    dust_jump: { frames: 5, fps: 16, loop: false }, // effect
    dust_run: { frames: 6, fps: 14, loop: true }, // effect
  };

  function animationsFor(character) {
    const defs = {};
    for (const [name, def] of Object.entries(ANIMATIONS)) {
      defs[name] = {
        ...def,
        url: chrome.runtime.getURL(`assets/${character}/${name}.png`),
      };
    }
    return defs;
  }

  class Sprite {
    constructor(el, character, scale) {
      this.el = el;
      this.scale = scale;
      this.size = FRAME_SIZE * scale;
      this.el.style.width = `${this.size}px`;
      this.el.style.height = `${this.size}px`;
      this.animations = animationsFor(character);
      this.name = null;
      this.frame = 0;
      this.elapsed = 0;
      this.onEnd = null;
      this.facing = 1;
    }

    // `onEnd` fires once when a non-looping animation reaches its last frame.
    // `restart` replays an animation that is already current, so a second poke
    // mid-flinch starts the flinch over rather than being swallowed.
    play(name, onEnd = null, restart = false) {
      const def = this.animations[name];
      if (!def) throw new Error(`unknown animation: ${name}`);

      this.onEnd = onEnd;
      if (this.name === name && !restart) return;

      this.name = name;
      this.frame = 0;
      this.elapsed = 0;
      this.el.style.backgroundImage = `url("${def.url}")`;
      this.el.style.backgroundSize = `${def.frames * this.size}px ${this.size}px`;
      this.#paint();
    }

    face(direction) {
      this.facing = direction < 0 ? -1 : 1;
    }

    tick(dt) {
      const def = this.animations[this.name];
      this.elapsed += dt;

      const step = 1 / def.fps;
      while (this.elapsed >= step) {
        this.elapsed -= step;
        if (this.frame + 1 < def.frames) {
          this.frame++;
        } else if (def.loop) {
          this.frame = 0;
        } else {
          // Hold the final frame and notify once.
          this.elapsed = 0;
          const done = this.onEnd;
          this.onEnd = null;
          if (done) done();
          break;
        }
      }
      this.#paint();
    }

    #paint() {
      this.el.style.backgroundPosition = `${-this.frame * this.size}px 0`;
    }

    render(x, y) {
      // scaleX flip is applied around the element centre, so translate first.
      this.el.style.transform = `translate3d(${x}px, ${y}px, 0) scaleX(${this.facing})`;
    }
    setCharacter(newCharacter) {
      this.animations = animationsFor(newCharacter);
      // If nothing has played yet, there's no current animation to re-apply —
      // play() would throw on a null name. Leave it for the first real play().
      if (this.name) this.play(this.name, this.onEnd, true);
    }
  }

  NS.Sprite = Sprite;
  NS.CHARACTERS = CHARACTERS;
  NS.FRAME_SIZE = FRAME_SIZE;
})();
