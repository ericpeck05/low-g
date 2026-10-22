// Little line-drawn icons for Drone Siege's suit mods and power-ups, drawn with a 2D
// canvas so the same drawing appears on the stations, the floating power-ups and the HUD.
// Each draws into a square of side `s` with its top-left at (0, 0), in the current stroke color.

export type IconId = 'plating' | 'cycler' | 'thruster' | 'overcharge' | 'recycler' | 'medic' | 'maxAmmo' | 'doublePoints' | 'oneShot' | 'emp' | 'o2';

type Draw = (ctx: CanvasRenderingContext2D, s: number) => void;

const ICONS: Record<IconId, Draw> = {
  // A shield.
  plating: (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.12);
    ctx.lineTo(s * 0.84, s * 0.26);
    ctx.quadraticCurveTo(s * 0.82, s * 0.7, s * 0.5, s * 0.9);
    ctx.quadraticCurveTo(s * 0.18, s * 0.7, s * 0.16, s * 0.26);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.3);
    ctx.lineTo(s * 0.5, s * 0.72);
    ctx.moveTo(s * 0.32, s * 0.48);
    ctx.lineTo(s * 0.68, s * 0.48);
    ctx.stroke();
  },
  // Two arrows chasing each other round.
  cycler: (ctx, s) => {
    for (const start of [0.2, Math.PI + 0.2]) {
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.3, start, start + Math.PI - 0.5);
      ctx.stroke();
      const end = start + Math.PI - 0.5;
      const x = s * 0.5 + Math.cos(end) * s * 0.3;
      const y = s * 0.5 + Math.sin(end) * s * 0.3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(end - 2.2) * s * 0.12, y + Math.sin(end - 2.2) * s * 0.12);
      ctx.lineTo(x, y);
      ctx.lineTo(x + Math.cos(end + 0.6) * s * 0.12, y + Math.sin(end + 0.6) * s * 0.12);
      ctx.stroke();
    }
  },
  // Chevrons pointing up over a flame.
  thruster: (ctx, s) => {
    for (const y of [0.2, 0.38]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.26, s * (y + 0.16));
      ctx.lineTo(s * 0.5, s * y);
      ctx.lineTo(s * 0.74, s * (y + 0.16));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.6);
    ctx.quadraticCurveTo(s * 0.68, s * 0.74, s * 0.5, s * 0.9);
    ctx.quadraticCurveTo(s * 0.32, s * 0.74, s * 0.5, s * 0.6);
    ctx.stroke();
  },
  // A lightning bolt.
  overcharge: (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.58, s * 0.1);
    ctx.lineTo(s * 0.3, s * 0.55);
    ctx.lineTo(s * 0.5, s * 0.55);
    ctx.lineTo(s * 0.42, s * 0.9);
    ctx.lineTo(s * 0.72, s * 0.42);
    ctx.lineTo(s * 0.52, s * 0.42);
    ctx.closePath();
    ctx.stroke();
  },
  // O2 in a ring.
  recycler: (ctx, s) => {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    letters(ctx, s, 'O2', 0.32);
  },
  // A cross in a circle (a medic's mark).
  medic: (ctx, s) => {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.3);
    ctx.lineTo(s * 0.5, s * 0.7);
    ctx.moveTo(s * 0.3, s * 0.5);
    ctx.lineTo(s * 0.7, s * 0.5);
    ctx.stroke();
  },
  // Three rounds standing side by side.
  maxAmmo: (ctx, s) => {
    for (const x of [0.32, 0.5, 0.68]) {
      ctx.beginPath();
      ctx.moveTo(s * (x - 0.06), s * 0.84);
      ctx.lineTo(s * (x - 0.06), s * 0.38);
      ctx.quadraticCurveTo(s * x, s * 0.14, s * (x + 0.06), s * 0.38);
      ctx.lineTo(s * (x + 0.06), s * 0.84);
      ctx.closePath();
      ctx.stroke();
    }
  },
  doublePoints: (ctx, s) => letters(ctx, s, '×2', 0.46),
  // A crosshair with a dot.
  oneShot: (ctx, s) => {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of [[0.5, 0.08, 0.5, 0.3], [0.5, 0.7, 0.5, 0.92], [0.08, 0.5, 0.3, 0.5], [0.7, 0.5, 0.92, 0.5]]) {
      ctx.moveTo(s * x0, s * y0);
      ctx.lineTo(s * x1, s * y1);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
  },
  // A burst: a ring with rays.
  emp: (ctx, s) => {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.moveTo(s * 0.5 + Math.cos(a) * s * 0.26, s * 0.5 + Math.sin(a) * s * 0.26);
      ctx.lineTo(s * 0.5 + Math.cos(a) * s * (k % 2 ? 0.36 : 0.42), s * 0.5 + Math.sin(a) * s * (k % 2 ? 0.36 : 0.42));
    }
    ctx.stroke();
  },
  o2: (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.1);
    ctx.quadraticCurveTo(s * 0.82, s * 0.5, s * 0.5, s * 0.9);
    ctx.quadraticCurveTo(s * 0.18, s * 0.5, s * 0.5, s * 0.1);
    ctx.stroke();
    letters(ctx, s, 'O2', 0.26, 0.58);
  },
};

function letters(ctx: CanvasRenderingContext2D, s: number, text: string, size: number, y = 0.52) {
  ctx.save();
  ctx.font = `bold ${Math.round(s * size)}px "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fillText(text, s * 0.5, s * y);
  ctx.restore();
}

/** Draw an icon at (x, y), `size` across, in `color`. */
export function drawIcon(ctx: CanvasRenderingContext2D, id: IconId, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ICONS[id](ctx, size);
  ctx.restore();
}

const cache = new Map<string, string>();

/** An icon as an image URL, for the HUD. */
export function iconUrl(id: IconId, color = '#ffa31a') {
  const key = `${id}|${color}`;
  if (!cache.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    drawIcon(canvas.getContext('2d')!, id, 0, 0, 64, color);
    cache.set(key, canvas.toDataURL());
  }
  return cache.get(key)!;
}
