// 2D map layer of the metro (docs/game-design-v02.md): the tunnels, the stations and, faintly, the
// reach of the stations of a working line. Visible while the metro rules are on and a metro tool
// is chosen or «Plan du métro» is on (transit-model.js owns that state). It paints over the tiles
// and never changes them.
import {
  metroShown, readParams, CODE_TUNNEL, CODE_TUNNEL_WORKING, CODE_STATION, CODE_STATION_WORKING,
} from "./transit-model.js";

export const COLORS = Object.freeze({
  reach: "rgba(30, 110, 230, 0.10)",
  tunnel: "rgba(110, 110, 130, 0.70)",
  tunnelWorking: "rgba(25, 95, 220, 0.85)",
  station: "#b9770e",
  stationWorking: "#e8590c",
  outline: "#ffffff",
});

function draw(ctx, city, scale) {
  const w = city.width(), h = city.height();
  const codes = city.transit_layer();
  const radius = readParams(city).radius;
  const byCode = new Map([CODE_TUNNEL, CODE_TUNNEL_WORKING, CODE_STATION, CODE_STATION_WORKING].map((c) => [c, []]));
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) byCode.get(codes[x * h + y])?.push({ x, y });
  }
  const tiles = (code) => byCode.get(code);
  ctx.save();
  // the reach of the stations that work, under the rest
  ctx.fillStyle = COLORS.reach;
  for (const s of tiles(CODE_STATION_WORKING)) {
    ctx.beginPath();
    ctx.arc((s.x + 0.5) * scale, (s.y + 0.5) * scale, radius * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [code, color] of [[CODE_TUNNEL, COLORS.tunnel], [CODE_TUNNEL_WORKING, COLORS.tunnelWorking]]) {
    ctx.fillStyle = color;
    for (const t of tiles(code)) ctx.fillRect(t.x * scale, t.y * scale, scale, scale);
  }
  ctx.lineWidth = Math.max(1, scale / 8);
  ctx.strokeStyle = COLORS.outline;
  for (const [code, color] of [[CODE_STATION, COLORS.station], [CODE_STATION_WORKING, COLORS.stationWorking]]) {
    ctx.fillStyle = color;
    for (const s of tiles(code)) {
      ctx.beginPath();
      ctx.arc((s.x + 0.5) * scale, (s.y + 0.5) * scale, scale * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

export const TRANSIT_LAYER = Object.freeze({
  name: "transit",
  visible: (city) => metroShown(city),
  draw,
});
