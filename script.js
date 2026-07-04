/* ==========================================================================
   SPACE ESCAPE RUNNER — GAME ENGINE
   Vanilla JS + HTML5 Canvas. No external assets or backend required.
   Structure:
     1. Config & constants
     2. Storage helpers (localStorage)
     3. Audio manager (synthesized via WebAudio — no sound files needed)
     4. Utility functions
     5. Entity classes: Star, Player, Obstacle, PowerUp, Coin, Particle
     6. Achievements
     7. Game class (state machine + main loop)
     8. UI wiring (screens, buttons, settings)
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. CONFIG & CONSTANTS
   * ------------------------------------------------------------------ */

  const CONFIG = {
    difficultyTiers: {
      easy:   { speedMul: 0.8,  spawnMul: 0.8,  lives: 4 },
      normal: { speedMul: 1.0,  spawnMul: 1.0,  lives: 3 },
      hard:   { speedMul: 1.35, spawnMul: 1.25, lives: 2 },
    },
    baseObstacleSpeed: 220,       // px/sec
    baseSpawnInterval: 1.1,       // seconds between obstacle spawns
    difficultyStepSeconds: 20,    // ramp up every 20s
    difficultySpeedGrowth: 0.09,  // +9% speed per step
    difficultySpawnGrowth: 0.10,  // +10% spawn rate per step
    levelPoints: 1000,            // points per level
    coinScore: 10,
    shieldDuration: 5,
    speedBoostDuration: 4,
    magnetDuration: 6,
    magnetRadius: 140,
    playerAccel: 2600,
    playerMaxSpeed: 560,
    playerDrag: 10,
  };

  const OBSTACLE_TYPES = [
    { key: 'asteroid',   icon: '☄️', minLevel: 0, weight: 30, r: 26 },
    { key: 'debris',     icon: '🛰️', minLevel: 0, weight: 25, r: 24 },
    { key: 'satellite',  icon: '🚀', minLevel: 0, weight: 20, r: 26 },
    { key: 'meteor',     icon: '💥', minLevel: 0, weight: 20, r: 24 },
    { key: 'alien',      icon: '👽', minLevel: 1, weight: 5,  r: 28 }, // rare, unlocks at level 2
  ];

  const POWERUP_TYPES = [
    { key: 'shield', icon: '🛡' },
    { key: 'magnet', icon: '🧲' },
    { key: 'speed',  icon: '⚡' },
    { key: 'life',   icon: '❤️' },
  ];

  const ACHIEVEMENTS = [
    { id: 'first_flight', name: 'First Flight',      desc: 'Play your first run',            icon: '🚀', check: s => s.gamesPlayed >= 1 },
    { id: 'coins_100',    name: '100 Coins',          desc: 'Collect 100 coins total',        icon: '🪙', check: s => s.totalCoins >= 100 },
    { id: 'survive_5min', name: 'Survive 5 Minutes',  desc: 'Survive a single run for 5 min', icon: '⏱️', check: s => s.bestSurvivalTime >= 300 },
    { id: 'score_10000',  name: '10,000 Score',       desc: 'Reach a score of 10,000',        icon: '🌟', check: s => s.highScore >= 10000 },
    { id: 'master_pilot', name: 'Master Pilot',       desc: 'Reach level 5 in a single run',  icon: '🎖️', check: s => s.bestLevel >= 5 },
  ];

  /* ------------------------------------------------------------------ *
   * 2. STORAGE HELPERS
   * ------------------------------------------------------------------ */

  const STORAGE_KEY = 'spaceEscapeRunner.save.v1';

  const defaultSave = () => ({
    highScore: 0,
    totalCoins: 0,
    gamesPlayed: 0,
    bestSurvivalTime: 0,
    bestLevel: 1,
    unlockedAchievements: [],
    settings: {
      music: true,
      sound: true,
      vibration: true,
      difficulty: 'normal',
    },
  });

  const Storage = {
    data: null,
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this.data = raw ? { ...defaultSave(), ...JSON.parse(raw) } : defaultSave();
        // ensure nested settings object is complete
        this.data.settings = { ...defaultSave().settings, ...(this.data.settings || {}) };
      } catch (e) {
        this.data = defaultSave();
      }
      return this.data;
    },
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) { /* storage unavailable — fail silently */ }
    },
  };

  /* ------------------------------------------------------------------ *
   * 3. AUDIO MANAGER (synthesized — zero external sound files)
   * ------------------------------------------------------------------ */

  class AudioManager {
    constructor() {
      this.ctx = null;
      this.musicNodes = null;
      this.musicOn = true;
      this.soundOn = true;
    }

    ensureCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    tone(freq, duration, type = 'sine', vol = 0.18, glideTo = null) {
      if (!this.soundOn) return;
      const ctx = this.ensureCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, ctx.currentTime + duration);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    }

    coin() { this.tone(880, 0.12, 'triangle', 0.2, 1400); }
    click() { this.tone(440, 0.06, 'square', 0.12); }
    powerup() {
      this.tone(520, 0.14, 'sawtooth', 0.16, 900);
      setTimeout(() => this.tone(760, 0.16, 'sine', 0.14, 1200), 90);
    }
    explosion() {
      if (!this.soundOn) return;
      const ctx = this.ensureCtx();
      const bufferSize = ctx.sampleRate * 0.35;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.35);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start();
    }
    gameOver() {
      this.tone(300, 0.25, 'sawtooth', 0.18, 90);
    }

    startMusic() {
      if (!this.musicOn || this.musicNodes) return;
      const ctx = this.ensureCtx();
      const master = ctx.createGain();
      master.gain.value = 0.05;
      master.connect(ctx.destination);

      // simple ambient two-note pad drifting slowly — avoids needing audio files
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine'; osc2.type = 'sine';
      osc1.frequency.value = 110;
      osc2.frequency.value = 165;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain).connect(osc2.frequency);

      osc1.connect(master);
      osc2.connect(master);
      osc1.start(); osc2.start(); lfo.start();

      this.musicNodes = { osc1, osc2, lfo, master };
    }
    stopMusic() {
      if (this.musicNodes) {
        Object.values(this.musicNodes).forEach(n => { try { n.stop && n.stop(); n.disconnect && n.disconnect(); } catch (e) {} });
        this.musicNodes = null;
      }
    }
    setMusicOn(on) {
      this.musicOn = on;
      if (!on) this.stopMusic(); else this.startMusic();
    }
    setSoundOn(on) { this.soundOn = on; }
  }

  /* ------------------------------------------------------------------ *
   * 4. UTILITY FUNCTIONS
   * ------------------------------------------------------------------ */

  const rand = (min, max) => Math.random() * (max - min) + min;
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function weightedPick(list) {
    const total = list.reduce((s, o) => s + o.weight, 0);
    let r = rand(0, total);
    for (const item of list) {
      if (r < item.weight) return item;
      r -= item.weight;
    }
    return list[0];
  }

  function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    return Math.hypot(dx, dy) < (ar + br) * 0.72; // slightly forgiving hitbox
  }

  function vibrate(pattern) {
    if (Storage.data.settings.vibration && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------------ *
   * 5. ENTITY CLASSES
   * ------------------------------------------------------------------ */

  class Star {
    constructor(w, h) { this.reset(w, h, true); }
    reset(w, h, initial = false) {
      this.x = rand(0, w);
      this.y = initial ? rand(0, h) : -4;
      this.layer = randInt(1, 3); // parallax depth
      this.size = this.layer === 3 ? rand(1.6, 2.6) : this.layer === 2 ? rand(1, 1.8) : rand(0.5, 1.1);
      this.speed = this.layer * rand(40, 70);
      this.twinkle = rand(0, Math.PI * 2);
    }
    update(dt, w, h, speedMul) {
      this.y += this.speed * speedMul * dt;
      this.twinkle += dt * 3;
      if (this.y > h + 4) this.reset(w, h);
    }
    draw(ctx) {
      const alpha = 0.5 + Math.sin(this.twinkle) * 0.5;
      ctx.globalAlpha = clamp(alpha, 0.2, 1);
      ctx.fillStyle = this.layer === 3 ? '#eef2ff' : this.layer === 2 ? '#b9c3ff' : '#6c7bb3';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  class Particle {
    constructor(x, y, color) {
      this.x = x; this.y = y;
      const a = rand(0, Math.PI * 2);
      const spd = rand(60, 260);
      this.vx = Math.cos(a) * spd;
      this.vy = Math.sin(a) * spd;
      this.life = rand(0.35, 0.75);
      this.age = 0;
      this.size = rand(2, 5);
      this.color = color;
    }
    update(dt) {
      this.age += dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= 0.94; this.vy *= 0.94;
    }
    get dead() { return this.age >= this.life; }
    draw(ctx) {
      const t = 1 - this.age / this.life;
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  class Player {
    constructor(w, h) {
      this.w = 46; this.h = 54;
      this.x = w / 2;
      this.y = h - 120;
      this.vx = 0;
      this.targetX = this.x;
      this.thrusterFlicker = 0;
      this.invincible = false;
      this.invincibleTimer = 0;
    }
    update(dt, bounds) {
      // smooth acceleration toward target (drag input) or from key/button holds
      const dx = this.targetX - this.x;
      this.vx += dx * 10 * dt;
      this.vx *= (1 - Math.min(1, CONFIG.playerDrag * dt * 0.15));
      this.vx = clamp(this.vx, -CONFIG.playerMaxSpeed, CONFIG.playerMaxSpeed);
      this.x += this.vx * dt;
      this.x = clamp(this.x, bounds.left, bounds.right);
      this.thrusterFlicker += dt * 20;
      if (this.invincibleTimer > 0) {
        this.invincibleTimer -= dt;
        if (this.invincibleTimer <= 0) this.invincible = false;
      }
    }
    nudge(dir, dt) {
      // used by keyboard / touch buttons for continuous movement
      this.targetX += dir * CONFIG.playerAccel * dt * 0.14;
    }
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);

      // thruster flame
      const flameLen = 14 + Math.sin(this.thrusterFlicker) * 5;
      const flameGrad = ctx.createLinearGradient(0, this.h / 2, 0, this.h / 2 + flameLen);
      flameGrad.addColorStop(0, 'rgba(0,229,255,0.9)');
      flameGrad.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(-8, this.h / 2 - 4);
      ctx.lineTo(0, this.h / 2 + flameLen);
      ctx.lineTo(8, this.h / 2 - 4);
      ctx.closePath();
      ctx.fill();

      // shield bubble
      if (this.invincible) {
        ctx.globalAlpha = 0.5 + Math.sin(this.thrusterFlicker * 2) * 0.2;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(0, 0, this.w * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // ship body (glowing triangle-based craft)
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 14;
      const grad = ctx.createLinearGradient(0, -this.h / 2, 0, this.h / 2);
      grad.addColorStop(0, '#eef2ff');
      grad.addColorStop(0.5, '#00e5ff');
      grad.addColorStop(1, '#6c3ce9');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -this.h / 2);
      ctx.lineTo(this.w / 2, this.h / 2 - 6);
      ctx.lineTo(this.w / 4, this.h / 2);
      ctx.lineTo(-this.w / 4, this.h / 2);
      ctx.lineTo(-this.w / 2, this.h / 2 - 6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // cockpit
      ctx.fillStyle = '#05061a';
      ctx.beginPath();
      ctx.ellipse(0, -4, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
    get radius() { return this.w * 0.4; }
  }

  class FallingEntity {
    constructor(x, y, speed, radius) {
      this.x = x; this.y = y;
      this.speed = speed;
      this.radius = radius;
      this.rotation = rand(0, Math.PI * 2);
      this.rotSpeed = rand(-1.5, 1.5);
      this.bob = rand(0, Math.PI * 2);
    }
    update(dt) {
      this.y += this.speed * dt;
      this.rotation += this.rotSpeed * dt;
      this.bob += dt * 3;
    }
    get offscreen() { return this.y - this.radius > 0; } // overridden by caller with height check
  }

  class Obstacle extends FallingEntity {
    constructor(type, x, y, speed) {
      super(x, y, speed, type.r);
      this.type = type;
    }
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      ctx.font = `${this.radius * 1.9}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = this.type.key === 'alien' ? '#ff2e88' : 'rgba(255,255,255,0.4)';
      ctx.shadowBlur = this.type.key === 'alien' ? 18 : 8;
      ctx.fillText(this.type.icon, 0, 0);
      ctx.restore();
    }
  }

  class PowerUp extends FallingEntity {
    constructor(type, x, y, speed) {
      super(x, y, speed, 22);
      this.type = type;
    }
    draw(ctx) {
      ctx.save();
      const bobY = Math.sin(this.bob) * 4;
      ctx.translate(this.x, this.y + bobY);
      ctx.shadowColor = '#ffb800';
      ctx.shadowBlur = 16;
      ctx.font = `${this.radius * 1.7}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,184,0,0.12)';
      ctx.fill();
      ctx.fillText(this.type.icon, 0, 0);
      ctx.restore();
    }
  }

  class Coin extends FallingEntity {
    constructor(x, y, speed) {
      super(x, y, speed, 14);
    }
    draw(ctx) {
      ctx.save();
      const bobY = Math.sin(this.bob) * 3;
      ctx.translate(this.x, this.y + bobY);
      ctx.rotate(this.rotation);
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, this.radius);
      grad.addColorStop(0, '#fff4cf');
      grad.addColorStop(1, '#ffb800');
      ctx.fillStyle = grad;
      ctx.shadowColor = '#ffb800';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(5,6,26,0.5)';
      ctx.font = `${this.radius}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, 1);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ *
   * 6. LEVEL THEMES (background changes every 1000 pts)
   * ------------------------------------------------------------------ */

  const LEVEL_THEMES = [
    { top: '#05061a', bottom: '#0b0f2e', nebula: 'rgba(108,60,233,0.25)' },
    { top: '#0a0330', bottom: '#1a0b3d', nebula: 'rgba(255,46,136,0.22)' },
    { top: '#001a2e', bottom: '#012b3d', nebula: 'rgba(0,229,255,0.22)' },
    { top: '#210a12', bottom: '#3a0f1a', nebula: 'rgba(255,88,0,0.22)' },
    { top: '#0a1f0f', bottom: '#123a1a', nebula: 'rgba(0,255,150,0.2)' },
    { top: '#1a0a2e', bottom: '#2e0a3a', nebula: 'rgba(190,60,233,0.25)' },
  ];

  /* ------------------------------------------------------------------ *
   * 7. GAME CLASS
   * ------------------------------------------------------------------ */

  class Game {
    constructor() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.audio = new AudioManager();
      this.save = Storage.load();
      this.audio.setMusicOn(this.save.settings.music);
      this.audio.setSoundOn(this.save.settings.sound);

      this.state = 'splash'; // splash | playing | paused | gameover
      this.resize();
      window.addEventListener('resize', () => this.resize());

      this.stars = [];
      this.obstacles = [];
      this.powerups = [];
      this.coins = [];
      this.particles = [];

      this.lastTime = 0;
      this.unlockedThisRun = [];

      this.initStars();
      this.bindInput();
      this.bindUI();
      this.updateSplashUI();

      requestAnimationFrame(t => this.loop(t));
    }

    /* ---------------- setup ---------------- */

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    initStars() {
      this.stars = [];
      const count = Math.round((this.width * this.height) / 4500);
      for (let i = 0; i < count; i++) this.stars.push(new Star(this.width, this.height));
    }

    resetRunState() {
      const diffKey = this.save.settings.difficulty;
      this.diff = CONFIG.difficultyTiers[diffKey] || CONFIG.difficultyTiers.normal;

      this.player = new Player(this.width, this.height);
      this.player.targetX = this.player.x;

      this.obstacles = [];
      this.powerups = [];
      this.coins = [];
      this.particles = [];

      this.score = 0;
      this.distance = 0;
      this.coinsThisRun = 0;
      this.survivalTime = 0;
      this.lives = this.diff.lives;
      this.level = 1;
      this.theme = LEVEL_THEMES[0];

      this.spawnTimer = 0;
      this.coinSpawnTimer = 0;
      this.powerupSpawnTimer = rand(6, 10);
      this.difficultyTimer = 0;
      this.speedMul = this.diff.speedMul;
      this.spawnMul = this.diff.spawnMul;

      this.shieldActive = false;
      this.shieldTimer = 0;
      this.magnetActive = false;
      this.magnetTimer = 0;
      this.speedBoostActive = false;
      this.speedBoostTimer = 0;

      this.unlockedThisRun = [];

      document.getElementById('shieldTimerWrap').classList.add('hidden');
    }

    /* ---------------- input ---------------- */

    bindInput() {
      let dragging = false;
      let startX = 0;
      let startPlayerX = 0;

      const onDown = (clientX) => {
        if (this.state !== 'playing') return;
        dragging = true;
        startX = clientX;
        startPlayerX = this.player.targetX;
      };
      const onMove = (clientX) => {
        if (!dragging || this.state !== 'playing') return;
        const dx = clientX - startX;
        this.player.targetX = clamp(startPlayerX + dx, this.playerBoundsLeft(), this.playerBoundsRight());
      };
      const onUp = () => { dragging = false; };

      this.canvas.addEventListener('touchstart', e => { onDown(e.touches[0].clientX); }, { passive: true });
      this.canvas.addEventListener('touchmove', e => { onMove(e.touches[0].clientX); }, { passive: true });
      this.canvas.addEventListener('touchend', onUp);

      this.canvas.addEventListener('mousedown', e => onDown(e.clientX));
      window.addEventListener('mousemove', e => onMove(e.clientX));
      window.addEventListener('mouseup', onUp);

      // keyboard
      this.keys = {};
      window.addEventListener('keydown', e => {
        this.keys[e.key.toLowerCase()] = true;
        if (e.key === 'Escape') this.togglePause();
      });
      window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

      // on-screen touch buttons
      const btnLeft = document.getElementById('btnLeft');
      const btnRight = document.getElementById('btnRight');
      const setHeld = (el, key) => {
        const start = ev => { ev.preventDefault(); this.keys[key] = true; };
        const end = ev => { ev.preventDefault(); this.keys[key] = false; };
        el.addEventListener('touchstart', start, { passive: false });
        el.addEventListener('touchend', end);
        el.addEventListener('mousedown', start);
        el.addEventListener('mouseup', end);
        el.addEventListener('mouseleave', end);
      };
      setHeld(btnLeft, 'arrowleft');
      setHeld(btnRight, 'arrowright');
    }

    playerBoundsLeft() { return this.player.w / 2 + 6; }
    playerBoundsRight() { return this.width - this.player.w / 2 - 6; }

    handleContinuousInput(dt) {
      if (this.keys['arrowleft'] || this.keys['a']) this.player.nudge(-1, dt);
      if (this.keys['arrowright'] || this.keys['d']) this.player.nudge(1, dt);
      this.player.targetX = clamp(this.player.targetX, this.playerBoundsLeft(), this.playerBoundsRight());
    }

    /* ---------------- UI wiring ---------------- */

    bindUI() {
      const $ = id => document.getElementById(id);
      const click = (id, fn) => $(id).addEventListener('click', () => { this.audio.click(); fn(); });

      click('playBtn', () => this.startGame());
      click('settingsBtn', () => this.showScreen('settingsScreen'));
      click('achievementsBtn', () => { this.renderAchievements(); this.showScreen('achievementsScreen'); });
      click('closeSettingsBtn', () => this.showScreen('splashScreen'));
      click('closeAchievementsBtn', () => this.showScreen('splashScreen'));

      click('pauseBtn', () => this.togglePause());
      click('resumeBtn', () => this.togglePause());
      click('restartFromPauseBtn', () => this.startGame());
      click('homeFromPauseBtn', () => this.goHome());

      click('restartBtn', () => this.startGame());
      click('homeBtn', () => this.goHome());
      click('shareBtn', () => this.shareScore());

      // settings toggles
      const bindToggle = (id, key, applyFn) => {
        const el = $(id);
        const refresh = () => {
          const on = this.save.settings[key];
          el.textContent = on ? 'ON' : 'OFF';
          el.classList.toggle('off', !on);
        };
        el.addEventListener('click', () => {
          this.save.settings[key] = !this.save.settings[key];
          Storage.save();
          refresh();
          if (applyFn) applyFn(this.save.settings[key]);
          this.audio.click();
        });
        refresh();
      };
      bindToggle('musicToggle', 'music', on => this.audio.setMusicOn(on));
      bindToggle('soundToggle', 'sound', on => this.audio.setSoundOn(on));
      bindToggle('vibrationToggle', 'vibration');

      document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.save.settings.difficulty = btn.dataset.diff;
          Storage.save();
          this.refreshDifficultyButtons();
          this.audio.click();
        });
      });
      this.refreshDifficultyButtons();

      // resume audio context on first user gesture (mobile autoplay policies)
      const resumeAudioOnce = () => {
        this.audio.ensureCtx();
        window.removeEventListener('touchstart', resumeAudioOnce);
        window.removeEventListener('mousedown', resumeAudioOnce);
      };
      window.addEventListener('touchstart', resumeAudioOnce, { once: true });
      window.addEventListener('mousedown', resumeAudioOnce, { once: true });
    }

    refreshDifficultyButtons() {
      document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.diff === this.save.settings.difficulty);
      });
    }

    showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      document.getElementById(id).classList.remove('hidden');
    }

    hideAllScreens() {
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    }

    updateSplashUI() {
      document.getElementById('splashHighScore').textContent = this.save.highScore.toLocaleString();
    }

    /* ---------------- game flow ---------------- */

    startGame() {
      this.resetRunState();
      this.hideAllScreens();
      document.getElementById('hud').classList.remove('hidden');
      document.getElementById('touchControls').classList.remove('hidden');
      this.state = 'playing';
      this.audio.setMusicOn(this.save.settings.music);
      this.updateHUD();
    }

    togglePause() {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.showScreen('pauseMenu');
        document.getElementById('hud').classList.add('hidden');
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.hideAllScreens();
        document.getElementById('hud').classList.remove('hidden');
      }
    }

    goHome() {
      this.state = 'splash';
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('touchControls').classList.add('hidden');
      this.updateSplashUI();
      this.showScreen('splashScreen');
    }

    endGame() {
      this.state = 'gameover';
      this.audio.gameOver();
      vibrate([80, 40, 120]);

      // persist stats
      this.save.gamesPlayed += 1;
      this.save.totalCoins += this.coinsThisRun;
      if (this.score > this.save.highScore) this.save.highScore = Math.floor(this.score);
      if (this.survivalTime > this.save.bestSurvivalTime) this.save.bestSurvivalTime = this.survivalTime;
      if (this.level > this.save.bestLevel) this.save.bestLevel = this.level;
      Storage.save();
      this.checkAchievements();

      document.getElementById('finalScore').textContent = Math.floor(this.score).toLocaleString();
      document.getElementById('finalHighScore').textContent = this.save.highScore.toLocaleString();
      document.getElementById('finalCoins').textContent = this.coinsThisRun;
      document.getElementById('finalDistance').textContent = `${Math.floor(this.distance)} m`;
      document.getElementById('finalTime').textContent = `${Math.floor(this.survivalTime)}s`;

      document.getElementById('hud').classList.add('hidden');
      document.getElementById('touchControls').classList.add('hidden');
      this.showScreen('gameOverScreen');
    }

    shareScore() {
      const text = `I scored ${Math.floor(this.score).toLocaleString()} points in Space Escape Runner! Can you beat it? 🚀`;
      if (navigator.share) {
        navigator.share({ text }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          this.toast('📋', 'Score copied to clipboard!');
        }).catch(() => {});
      }
    }

    /* ---------------- achievements ---------------- */

    checkAchievements() {
      const statSnapshot = {
        gamesPlayed: this.save.gamesPlayed,
        totalCoins: this.save.totalCoins,
        bestSurvivalTime: this.save.bestSurvivalTime,
        highScore: this.save.highScore,
        bestLevel: this.save.bestLevel,
      };
      ACHIEVEMENTS.forEach(a => {
        if (!this.save.unlockedAchievements.includes(a.id) && a.check(statSnapshot)) {
          this.save.unlockedAchievements.push(a.id);
          this.toast(a.icon, `${a.name} unlocked!`);
        }
      });
      Storage.save();
    }

    renderAchievements() {
      const list = document.getElementById('achievementsList');
      list.innerHTML = '';
      ACHIEVEMENTS.forEach(a => {
        const unlocked = this.save.unlockedAchievements.includes(a.id);
        const div = document.createElement('div');
        div.className = 'achievement-item' + (unlocked ? ' unlocked' : '');
        div.innerHTML = `
          <span class="achievement-icon">${a.icon}</span>
          <div>
            <div class="achievement-name">${a.name}</div>
            <div class="achievement-desc">${a.desc}</div>
          </div>`;
        list.appendChild(div);
      });
    }

    toast(icon, text) {
      const el = document.getElementById('toast');
      document.getElementById('toastIcon').textContent = icon;
      document.getElementById('toastText').textContent = text;
      el.classList.remove('hidden');
      // restart animation
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
    }

    /* ---------------- spawning ---------------- */

    spawnObstacle() {
      const available = OBSTACLE_TYPES.filter(t => t.minLevel <= this.level - 1);
      const type = weightedPick(available);
      const x = rand(40, this.width - 40);
      const speed = CONFIG.baseObstacleSpeed * this.speedMul * rand(0.85, 1.25);
      this.obstacles.push(new Obstacle(type, x, -40, speed));
    }

    spawnCoin() {
      const x = rand(30, this.width - 30);
      const speed = CONFIG.baseObstacleSpeed * this.speedMul * 0.9;
      this.coins.push(new Coin(x, -20, speed));
    }

    spawnPowerup() {
      const type = pick(POWERUP_TYPES);
      const x = rand(40, this.width - 40);
      const speed = CONFIG.baseObstacleSpeed * this.speedMul * 0.85;
      this.powerups.push(new PowerUp(type, x, -30, speed));
    }

    explodeAt(x, y, color = '#ff2e88') {
      for (let i = 0; i < 18; i++) this.particles.push(new Particle(x, y, color));
    }

    /* ---------------- update ---------------- */

    update(dt) {
      if (this.state !== 'playing') {
        // still animate background stars gently on menus
        this.stars.forEach(s => s.update(dt, this.width, this.height, 0.4));
        return;
      }

      this.survivalTime += dt;
      this.difficultyTimer += dt;

      // difficulty ramp every N seconds
      if (this.difficultyTimer >= CONFIG.difficultyStepSeconds) {
        this.difficultyTimer = 0;
        this.speedMul *= (1 + CONFIG.difficultySpeedGrowth);
        this.spawnMul *= (1 + CONFIG.difficultySpawnGrowth);
      }

      // effective speed multiplier including temporary speed boost
      const boostMul = this.speedBoostActive ? 1.6 : 1;
      const worldSpeedMul = this.speedMul * boostMul;

      // input & player
      this.handleContinuousInput(dt);
      this.player.update(dt, { left: this.playerBoundsLeft(), right: this.playerBoundsRight() });

      // background stars
      this.stars.forEach(s => s.update(dt, this.width, this.height, worldSpeedMul));

      // distance & score accrue over time (+ boosted while speed boost active)
      this.distance += (140 * worldSpeedMul * dt) / 10;
      this.score += 12 * worldSpeedMul * dt;

      // spawn timers
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnObstacle();
        this.spawnTimer = CONFIG.baseSpawnInterval / this.spawnMul * rand(0.85, 1.15);
      }
      this.coinSpawnTimer -= dt;
      if (this.coinSpawnTimer <= 0) {
        this.spawnCoin();
        this.coinSpawnTimer = rand(0.5, 1.1);
      }
      this.powerupSpawnTimer -= dt;
      if (this.powerupSpawnTimer <= 0) {
        this.spawnPowerup();
        this.powerupSpawnTimer = rand(9, 15);
      }

      // update entities
      this.obstacles.forEach(o => o.update(dt));
      this.coins.forEach(c => c.update(dt));
      this.powerups.forEach(p => p.update(dt));
      this.particles.forEach(p => p.update(dt));

      // magnet pulls coins toward player
      if (this.magnetActive) {
        this.coins.forEach(c => {
          const dx = this.player.x - c.x, dy = this.player.y - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist < CONFIG.magnetRadius) {
            c.x += (dx / dist) * 480 * dt;
            c.y += (dy / dist) * 480 * dt;
          }
        });
      }

      // timers: shield / magnet / speed boost
      if (this.shieldActive) {
        this.shieldTimer -= dt;
        this.player.invincible = true;
        if (this.shieldTimer <= 0) { this.shieldActive = false; this.player.invincible = false; }
        this.updateShieldUI();
      }
      if (this.magnetActive) { this.magnetTimer -= dt; if (this.magnetTimer <= 0) this.magnetActive = false; }
      if (this.speedBoostActive) { this.speedBoostTimer -= dt; if (this.speedBoostTimer <= 0) this.speedBoostActive = false; }

      // collisions: obstacles vs player
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        if (o.y - o.radius > this.height + 60) { this.obstacles.splice(i, 1); continue; }
        if (circleHit(this.player.x, this.player.y, this.player.radius, o.x, o.y, o.radius)) {
          this.obstacles.splice(i, 1);
          if (this.player.invincible) {
            this.explodeAt(o.x, o.y, '#00e5ff');
            this.audio.explosion();
          } else {
            this.explodeAt(o.x, o.y, '#ff2e88');
            this.audio.explosion();
            vibrate(60);
            this.loseLife();
          }
        }
      }

      // coins vs player
      for (let i = this.coins.length - 1; i >= 0; i--) {
        const c = this.coins[i];
        if (c.y - c.radius > this.height + 40) { this.coins.splice(i, 1); continue; }
        if (circleHit(this.player.x, this.player.y, this.player.radius, c.x, c.y, c.radius)) {
          this.coins.splice(i, 1);
          this.coinsThisRun += 1;
          this.score += CONFIG.coinScore;
          this.audio.coin();
          this.explodeAt(c.x, c.y, '#ffb800');
        }
      }

      // powerups vs player
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const p = this.powerups[i];
        if (p.y - p.radius > this.height + 40) { this.powerups.splice(i, 1); continue; }
        if (circleHit(this.player.x, this.player.y, this.player.radius, p.x, p.y, p.radius)) {
          this.powerups.splice(i, 1);
          this.applyPowerup(p.type.key);
          this.audio.powerup();
        }
      }

      // particles cleanup
      this.particles = this.particles.filter(p => !p.dead);

      // level progression
      const newLevel = Math.floor(this.score / CONFIG.levelPoints) + 1;
      if (newLevel !== this.level) {
        this.level = newLevel;
        this.theme = LEVEL_THEMES[(this.level - 1) % LEVEL_THEMES.length];
        this.toast('🌌', `Level ${this.level}!`);
      }

      this.updateHUD();
    }

    applyPowerup(key) {
      switch (key) {
        case 'shield':
          this.shieldActive = true;
          this.shieldTimer = CONFIG.shieldDuration;
          document.getElementById('shieldTimerWrap').classList.remove('hidden');
          break;
        case 'magnet':
          this.magnetActive = true;
          this.magnetTimer = CONFIG.magnetDuration;
          break;
        case 'speed':
          this.speedBoostActive = true;
          this.speedBoostTimer = CONFIG.speedBoostDuration;
          break;
        case 'life':
          this.lives += 1;
          break;
      }
    }

    loseLife() {
      this.lives -= 1;
      if (this.lives <= 0) {
        this.endGame();
      }
    }

    updateShieldUI() {
      const pct = clamp((this.shieldTimer / CONFIG.shieldDuration) * 100, 0, 100);
      document.getElementById('shieldBarFill').style.width = pct + '%';
    }

    updateHUD() {
      document.getElementById('hudScore').textContent = Math.floor(this.score).toLocaleString();
      document.getElementById('hudDistance').textContent = `${Math.floor(this.distance)} m`;
      document.getElementById('hudCoins').textContent = `🪙 ${this.coinsThisRun}`;
      document.getElementById('hudLives').textContent = '❤'.repeat(Math.max(0, this.lives));
    }

    /* ---------------- render ---------------- */

    drawBackground() {
      const ctx = this.ctx;
      const theme = this.theme || LEVEL_THEMES[0];
      const grad = ctx.createLinearGradient(0, 0, 0, this.height);
      grad.addColorStop(0, theme.top);
      grad.addColorStop(1, theme.bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, this.height);

      // nebula glow blob
      const nebulaGrad = ctx.createRadialGradient(
        this.width * 0.5, this.height * 0.25, 20,
        this.width * 0.5, this.height * 0.25, this.width * 0.8
      );
      nebulaGrad.addColorStop(0, theme.nebula);
      nebulaGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = nebulaGrad;
      ctx.fillRect(0, 0, this.width, this.height);

      this.stars.forEach(s => s.draw(ctx));
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      this.drawBackground();

      if (this.state === 'playing' || this.state === 'paused') {
        this.coins.forEach(c => c.draw(ctx));
        this.powerups.forEach(p => p.draw(ctx));
        this.obstacles.forEach(o => o.draw(ctx));
        this.particles.forEach(p => p.draw(ctx));
        this.player.draw(ctx);
      }
    }

    /* ---------------- main loop ---------------- */

    loop(time) {
      const dt = Math.min(0.035, (time - this.lastTime) / 1000 || 0);
      this.lastTime = time;
      this.update(dt);
      this.render();
      requestAnimationFrame(t => this.loop(t));
    }
  }

  /* ------------------------------------------------------------------ *
   * 8. BOOT
   * ------------------------------------------------------------------ */

  window.addEventListener('DOMContentLoaded', () => {
    new Game();
  });

})();
