// Moving objects over the map (presentation only, ARCHITECTURE.md rule 5): trains, helicopters,
// planes, ships, buses, monsters, tornadoes and explosions are drawn procedurally on a transparent
// layer. The engine says where each one is (city.sprites()); nothing here moves them.
//
// Decoding and geometry are pure (node:test). createSpriteLayer() is the only part that touches
// the page, and it is called at runtime only.

// SpriteType values of the engine (micropolis.h, sprite.rs).
export const SPRITE_KINDS = Object.freeze({
  1: "train",
  2: "helicopter",
  3: "airplane",
  4: "ship",
  5: "monster",
  6: "tornado",
  7: "explosion",
  8: "bus",
});

// Engine pixels per tile: positions in the sprite records are in these units.
export const ENGINE_PX = 16;

// Decodes the flat records of city.sprites() into objects. Anything that is not a whole record
// is ignored, so a malformed list draws nothing rather than something wrong.
export function decodeSprites(flat) {
  const out = [];
  if (!flat || typeof flat.length !== "number" || flat.length % 8 !== 0) return out;
  for (let i = 0; i < flat.length; i += 8) {
    const [kind, frame, x, y, xHot, yHot, width, height] = Array.from(flat.slice(i, i + 8));
    if (![kind, frame, x, y, xHot, yHot, width, height].every(Number.isFinite)) continue;
    out.push({
      kind,
      name: SPRITE_KINDS[kind] ?? "unknown",
      frame,
      x,
      y,
      xHot,
      yHot,
      width,
      height,
    });
  }
  return out;
}

// Where a sprite is drawn, in tiles: its hot point (the engine measures collisions from it, so it
// is the sprite's centre for the eye).
export function spriteCentre(s) {
  return { x: (s.x + s.xHot) / ENGINE_PX, y: (s.y + s.yHot) / ENGINE_PX };
}

// Heading of a moving object from where it was (`from`, null when unknown) to where it is (`to`),
// in tiles: the angle in radians (0 = east, positive = south). Keeps `previousAngle` while the
// object stands still.
export function headingFrom(from, to, previousAngle = 0) {
  if (!from) return previousAngle;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 0.02) return previousAngle;
  return Math.atan2(dy, dx);
}

// Keys that identify an object across frames: its kind and its order among objects of that kind.
// The engine keeps its list order from one tick to the next, so this is stable enough for a heading.
export function trackingKeys(sprites) {
  const seen = new Map();
  return sprites.map((s) => {
    const n = seen.get(s.kind) ?? 0;
    seen.set(s.kind, n + 1);
    return `${s.kind}#${n}`;
  });
}

// --- Drawers ------------------------------------------------------------------------------------
// Each drawer paints one object centred on (0, 0), facing east, in units of one tile (`u` pixels).
// The caller rotates the context to the heading. `t` is the clock in milliseconds (rotors, pulses).

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTrain(ctx, u) {
  roundRect(ctx, -1.0 * u, -0.22 * u, 2.0 * u, 0.44 * u, 0.08 * u);
  ctx.fillStyle = "#c0392b";
  ctx.fill();
  ctx.fillStyle = "#34495e";
  ctx.fillRect(0.45 * u, -0.14 * u, 0.4 * u, 0.12 * u); // cab window
  ctx.fillRect(-0.85 * u, -0.1 * u, 0.5 * u, 0.08 * u);
  ctx.fillStyle = "#f1c40f";
  ctx.fillRect(-0.9 * u, 0.1 * u, 1.8 * u, 0.06 * u); // livery stripe
}

function drawBus(ctx, u) {
  roundRect(ctx, -0.6 * u, -0.22 * u, 1.2 * u, 0.44 * u, 0.1 * u);
  ctx.fillStyle = "#f5b041";
  ctx.fill();
  ctx.fillStyle = "#2c3e50";
  for (let i = 0; i < 4; i++) ctx.fillRect((-0.5 + i * 0.27) * u, -0.14 * u, 0.2 * u, 0.12 * u);
}

function drawShip(ctx, u, t) {
  ctx.beginPath();
  ctx.moveTo(-0.7 * u, -0.3 * u);
  ctx.lineTo(0.75 * u, -0.3 * u);
  ctx.lineTo(0.55 * u, 0.3 * u);
  ctx.lineTo(-0.6 * u, 0.3 * u);
  ctx.closePath();
  ctx.fillStyle = "#ecf0f1";
  ctx.fill();
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(-0.68 * u, 0.12 * u, 1.3 * u, 0.1 * u);
  ctx.fillStyle = "#95a5a6";
  ctx.fillRect(-0.3 * u, -0.2 * u, 0.5 * u, 0.4 * u); // superstructure
  // wake, drifting back with the clock
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 0.05 * u;
  const off = ((t / 400) % 1) * 0.2;
  ctx.beginPath();
  ctx.moveTo(-0.8 * u, -0.05 * u - off * u);
  ctx.lineTo(-1.4 * u, -0.1 * u - off * u);
  ctx.moveTo(-0.8 * u, 0.05 * u + off * u);
  ctx.lineTo(-1.4 * u, 0.1 * u + off * u);
  ctx.stroke();
}

function drawAirplane(ctx, u) {
  ctx.fillStyle = "#f4f6f7";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.6 * u, 0.1 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.05 * u, -0.45 * u);
  ctx.lineTo(0.15 * u, -0.45 * u);
  ctx.lineTo(0.05 * u, 0.0);
  ctx.lineTo(-0.2 * u, 0.0);
  ctx.closePath();
  ctx.fill(); // wing
  ctx.beginPath();
  ctx.moveTo(0.02 * u, 0.45 * u);
  ctx.lineTo(0.16 * u, 0.45 * u);
  ctx.lineTo(0.06 * u, 0.0);
  ctx.lineTo(-0.2 * u, 0.0);
  ctx.closePath();
  ctx.fill(); // the other wing
  ctx.beginPath();
  ctx.moveTo(-0.5 * u, 0);
  ctx.lineTo(-0.7 * u, -0.22 * u);
  ctx.lineTo(-0.66 * u, 0);
  ctx.fill(); // tail
  ctx.strokeStyle = "#7f8c8d";
  ctx.lineWidth = 0.03 * u;
  ctx.stroke();
}

function drawHelicopter(ctx, u, t) {
  ctx.fillStyle = "#2e4057";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.4 * u, 0.2 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(0.3 * u, -0.05 * u, 0.6 * u, 0.1 * u); // tail boom
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(0.85 * u, -0.14 * u, 0.1 * u, 0.2 * u);
  // rotor: two blades turning
  ctx.save();
  ctx.rotate((t / 25) % (Math.PI * 2));
  ctx.strokeStyle = "rgba(20,20,20,0.75)";
  ctx.lineWidth = 0.05 * u;
  ctx.beginPath();
  ctx.moveTo(-0.7 * u, 0);
  ctx.lineTo(0.7 * u, 0);
  ctx.moveTo(0, -0.7 * u);
  ctx.lineTo(0, 0.7 * u);
  ctx.stroke();
  ctx.restore();
}

function drawMonster(ctx, u, t) {
  const step = Math.sin(t / 150) * 0.05;
  ctx.fillStyle = "#3a7d44";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.6 * u, 0.42 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.5 * u, 0);
  ctx.lineTo(-1.0 * u, 0.1 * u);
  ctx.lineTo(-0.5 * u, 0.12 * u);
  ctx.fill(); // tail
  ctx.fillStyle = "#2d5e34";
  for (const [x, y] of [[-0.3, -0.4], [0, -0.45], [0.3, -0.4]]) {
    ctx.beginPath();
    ctx.moveTo((x - 0.08) * u, y * u);
    ctx.lineTo(x * u, (y - 0.25) * u);
    ctx.lineTo((x + 0.08) * u, y * u);
    ctx.fill(); // back spikes
  }
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#3a7d44";
    ctx.fillRect(-0.3 * u, (side * 0.38 + step * side) * u, 0.18 * u, 0.12 * u);
    ctx.fillRect(0.12 * u, (side * 0.38 - step * side) * u, 0.18 * u, 0.12 * u);
  }
  ctx.fillStyle = "#f1c40f";
  ctx.fillRect(0.3 * u, -0.2 * u, 0.1 * u, 0.1 * u);
  ctx.fillRect(0.3 * u, 0.08 * u, 0.1 * u, 0.1 * u);
}

function drawTornado(ctx, u, t) {
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const y = -0.6 * u + (i * 1.2 * u) / bands;
    const half = (0.12 + (i / bands) * 0.45) * u;
    const wobble = Math.sin(t / 120 + i) * 0.06 * u;
    ctx.fillStyle = `rgba(90,98,108,${0.5 + (i / bands) * 0.3})`;
    ctx.fillRect(-half + wobble, y, 2 * half, 0.2 * u);
  }
  ctx.strokeStyle = "rgba(230,230,230,0.7)";
  ctx.lineWidth = 0.04 * u;
  ctx.setLineDash([0.1 * u, 0.1 * u]);
  ctx.lineDashOffset = -((t / 30) % (0.2 * u));
  ctx.beginPath();
  ctx.ellipse(0, 0.55 * u, 0.5 * u, 0.1 * u, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawExplosion(ctx, u, t, frame) {
  const pulse = 0.5 + 0.5 * Math.sin(t / 60 + frame);
  ctx.fillStyle = "rgba(255,120,30,0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, (0.45 + 0.2 * pulse) * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,230,90,0.95)";
  ctx.beginPath();
  ctx.arc(0, 0, (0.25 + 0.1 * (1 - pulse)) * u, 0, Math.PI * 2);
  ctx.fill();
}

// Draws every sprite of `sprites` (decodeSprites output) on `ctx`, one tile = `tilePx` pixels.
// The context is cleared first. `t` is the clock (ms). Returns the number of objects drawn.
export function paintSprites(ctx, sprites, { tilePx, t, headings }) {
  const keys = trackingKeys(sprites);
  let drawn = 0;
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    const c = spriteCentre(s);
    const key = keys[i];
    const prev = headings.get(key);
    const heading = headingFrom(prev ? prev.at : null, c, prev ? prev.angle : 0);
    headings.set(key, { at: c, angle: heading });
    const px = c.x * tilePx;
    const py = c.y * tilePx;
    // the drawers work in units of half the picture's size (the engine's width of 32 is 2 tiles)
    const u = (tilePx * Math.max(s.width, s.height)) / ENGINE_PX / 2;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(heading);
    switch (s.kind) {
      case 1: drawTrain(ctx, u); break;
      case 2: drawHelicopter(ctx, u, t); break;
      case 3: drawAirplane(ctx, u); break;
      case 4: drawShip(ctx, u, t); break;
      case 5: drawMonster(ctx, u, t); break;
      case 6: ctx.rotate(-heading); drawTornado(ctx, u, t); break;
      case 7: ctx.rotate(-heading); drawExplosion(ctx, u, t, s.frame); break;
      case 8: drawBus(ctx, u); break;
      default: ctx.restore(); continue;
    }
    ctx.restore();
    drawn++;
  }
  return drawn;
}

// --- Page layer ---------------------------------------------------------------------------------

// `createSpriteLayer({ doc, map, tilePx })` -> { paint(city, now) }: a transparent canvas placed
// right after the map canvas (pointer events go through it). `paint` draws the city's sprites
// (none when the engine has no sprites() method, as in the mock engine).
export function createSpriteLayer({ doc = globalThis.document, map, tilePx }) {
  const canvas = doc.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";
  map.after(canvas);
  const ctx = canvas.getContext("2d");
  const headings = new Map();
  let hadSprites = false;

  return {
    canvas,
    paint(city, now) {
      if (canvas.width !== map.width || canvas.height !== map.height) {
        canvas.width = map.width;
        canvas.height = map.height;
      }
      const flat = typeof city.sprites === "function" ? city.sprites() : null;
      const sprites = decodeSprites(flat);
      if (sprites.length === 0 && !hadSprites) return 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hadSprites = sprites.length > 0;
      if (!hadSprites) return 0;
      return paintSprites(ctx, sprites, { tilePx, t: now, headings });
    },
  };
}
