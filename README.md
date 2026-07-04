# 🚀 Space Escape Runner

A polished, mobile-friendly endless space runner built with plain HTML5, CSS3, and JavaScript (Canvas). No build tools, no backend, no external assets required — everything (including sound effects and music) is generated in-browser.

## How to run it

**Option 1 — just open it**
Double-click `index.html` and it will open in your default browser. That's it.

**Option 2 — local server (recommended for the best experience)**
Some browsers restrict certain features (like `localStorage` or audio autoplay) when opening files directly via `file://`. For the smoothest experience, serve the folder locally:

```bash
# Python 3
cd SpaceEscapeRunner
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

or with Node.js:

```bash
npx serve SpaceEscapeRunner
```

**Mobile:** open the same local server URL from your phone's browser (make sure your phone is on the same Wi-Fi network as your computer), or deploy the folder to any static host (GitHub Pages, Netlify, Vercel) and open the link on your phone.

## Controls

| Platform | Move Left | Move Right |
|---|---|---|
| Mobile | Swipe / drag left, or tap ◀ button | Swipe / drag right, or tap ▶ button |
| Desktop | ← Arrow key or `A` | → Arrow key or `D` |

Tap the ❚❚ button (or press `Esc`) to pause.

## Gameplay

- Pilot your spacecraft through an endless field of asteroids, space debris, broken satellites, meteors, and rare alien ships.
- Collect coins to boost your score, and grab power-ups for temporary abilities:
  - 🛡 **Shield** — 5 seconds of invincibility
  - 🧲 **Magnet** — pulls nearby coins toward you
  - ⚡ **Speed Boost** — temporarily increases speed (and score gain)
  - ❤️ **Extra Life** — grants one additional life
- Difficulty ramps up automatically every 20 seconds (faster obstacles, more frequent spawns).
- Every 1,000 points you level up: the background theme changes and tougher obstacle types (like alien ships) unlock.
- Your **High Score** and **total coins collected** are saved automatically to your browser's local storage, so they persist between visits.
- Unlock achievements as you play — check your progress from the Achievements screen on the home menu.

## Project structure

```
SpaceEscapeRunner/
│
├── index.html          # App shell + all UI screens (splash, HUD, pause, game over, settings, achievements)
├── style.css            # Space-themed styling, glow effects, responsive layout
├── script.js            # Full game engine (rendering, input, physics, audio, save data)
├── assets/
│   ├── images/          # (empty — all visuals are drawn live on canvas, no image files needed)
│   ├── sounds/          # (empty — all audio is synthesized in-browser via the Web Audio API)
│   └── fonts/           # (empty — fonts are loaded from Google Fonts via <link> in index.html)
└── README.md
```

### Why no image/sound asset files?
To keep this a genuinely "ready-to-run, no backend, no build step" project, every visual (ship, obstacles, stars, particles, coins) is drawn directly on the `<canvas>` using vector shapes and emoji glyphs, and every sound effect / music loop is synthesized on the fly with the Web Audio API. This means the game has **zero external dependencies** and works the moment you open `index.html` — but the `assets/` folders are included (and safe to use) if you'd like to swap in your own sprite art or audio files later. To do that:

1. Drop your files into `assets/images/` or `assets/sounds/`.
2. In `script.js`, replace the relevant `ctx.fillText(...)` emoji draws (search for the `Obstacle`, `PowerUp`, `Coin`, and `Player` classes) with `ctx.drawImage(...)` calls using a preloaded `Image` object.
3. For audio, replace calls in the `AudioManager` class (e.g. `this.coin()`, `this.explosion()`) with `new Audio('assets/sounds/yourfile.mp3').play()`.

## Customization tips

- **Tune difficulty / balance:** edit the `CONFIG` object at the top of `script.js` (spawn rates, speeds, power-up durations, etc.).
- **Add new obstacle or power-up types:** extend the `OBSTACLE_TYPES` / `POWERUP_TYPES` arrays.
- **Add new achievements:** extend the `ACHIEVEMENTS` array with an `id`, `name`, `desc`, `icon`, and a `check(stats)` function.
- **Level themes / background colors:** edit the `LEVEL_THEMES` array.

Enjoy the flight, pilot! 🛸
