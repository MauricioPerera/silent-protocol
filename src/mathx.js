// Utilidades matemáticas y de colisión (2D en el plano XZ)
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function angleTowards(cur, target, maxStep) {
  const d = normAngle(target - cur);
  return cur + clamp(d, -maxStep, maxStep);
}

// ¿el punto está dentro de la caja expandida en r?
export function pointInBox(x, z, b, r = 0) {
  return x > b.x - b.hw - r && x < b.x + b.hw + r && z > b.z - b.hd - r && z < b.z + b.hd + r;
}

// Resuelve un círculo contra cajas AABB (empuje por el eje de menor penetración)
export function resolveCircle(x, z, r, boxes) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of boxes) {
      const minX = b.x - b.hw - r, maxX = b.x + b.hw + r;
      const minZ = b.z - b.hd - r, maxZ = b.z + b.hd + r;
      if (x > minX && x < maxX && z > minZ && z < maxZ) {
        const dxL = x - minX, dxR = maxX - x, dzL = z - minZ, dzR = maxZ - z;
        const m = Math.min(dxL, dxR, dzL, dzR);
        if (m === dxL) x = minX; else if (m === dxR) x = maxX;
        else if (m === dzL) z = minZ; else z = maxZ;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, z };
}

// Intersección segmento / AABB (slab). Devuelve t de entrada o -1.
export function segBox(x0, z0, x1, z1, b) {
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  const lo = [b.x - b.hw, b.z - b.hd], hi = [b.x + b.hw, b.z + b.hd];
  const o = [x0, z0], d = [dx, dz];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Línea de visión libre de obstáculos altos
export function losClear(ax, az, bx, bz, boxes) {
  for (const b of boxes) {
    if (!b.tall) continue;
    const t = segBox(ax, az, bx, bz, b);
    if (t >= 0 && t <= 1) return false;
  }
  return true;
}

// Primer impacto de un rayo 2D contra cajas altas -> distancia
export function rayHitDistance(ax, az, dx, dz, maxD, boxes) {
  const bx = ax + dx * maxD, bz = az + dz * maxD;
  let best = maxD;
  for (const b of boxes) {
    if (!b.tall) continue;
    const t = segBox(ax, az, bx, bz, b);
    if (t >= 0 && t <= 1) best = Math.min(best, t * maxD);
  }
  return best;
}

export function angleDiff(a, b) { return Math.abs(normAngle(a - b)); }

// PRNG determinista con semilla (mulberry32) -> [0, 1)
export function createRng(seed = 0x517cc1b7) {
  let s = (Number(seed) >>> 0) || 0x517cc1b7;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng, min, max) {
  return min + (max - min) * rng();
}

export function rngInt(rng, min, maxInclusive) {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}
