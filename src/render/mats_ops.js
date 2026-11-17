/**
 * @license
 * Pure TypedArray Procedural PBR Node-Graph Operators for SILENT PROTOCOL.
 * Zero DOM / WebGL / Three.js dependencies (shared by main thread, Web Worker, and Node tests).
 *
 * Portions of the procedural node operators (`mcLevels` reciprocal midpoint
 * gamma curve, `directionalWarpedUV`, `slopeWarpedUV`, `directionalBlurField`,
 * and `BASE_RESOLUTION = 256` Sobel normal scaling) are adapted into JavaScript
 * TypedArray node operators from the Rust atomic node implementations in
 * MaterialCraft (https://github.com/storytold/materialcraft):
 *
 * Copyright (c) 2026 ArtCraft Team and the MaterialCraft contributors
 * SPDX-License-Identifier: MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export const ARCHETYPES = [
  'wood_parquet',
  'ceramic_tile',
  'concrete_service',
  'plaster_wall',
  'brushed_steel',
  'painted_metal',
  'fabric_suit',
  'leather_upholstery',
  'turf_garden',
];

function clamp01(v) {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Operador MaterialCraft: Levels con curva gamma recíproca en punto medio (levels.rs)
export function mcLevels(v, inLow, inMid, inHigh, outLow, outHigh) {
  if (!Number.isFinite(v) || !Number.isFinite(inLow) || !Number.isFinite(inHigh)) return outLow;
  const span = inHigh - inLow;
  const t = Math.abs(span) < 1e-6 ? (v >= inHigh ? 1 : 0) : clamp01((v - inLow) / span);
  if (t <= 0) return outLow;
  if (t >= 1) return outHigh;
  const rawMid = Number.isFinite(inMid) ? inMid : 0.5;
  const m = rawMid < 0.001 ? 0.001 : rawMid > 0.999 ? 0.999 : rawMid;
  const g = m <= 0.5 ? 1 / (9 - 16 * m) : 16 * m - 7;
  return outLow + Math.pow(t, g) * (outHigh - outLow);
}

function valueNoiseTile(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = ix0 + 1 === period ? 0 : ix0 + 1;
  const iy1 = iy0 + 1 === period ? 0 : iy0 + 1;
  const n00 = hash2(ix0, iy0, seed);
  const n10 = hash2(ix1, iy0, seed);
  const n01 = hash2(ix0, iy1, seed);
  const n11 = hash2(ix1, iy1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

let _u0 = 0;
let _v0 = 0;
let _f1 = 0;
let _fEdge = 0;
const _fbmGrid = new Float32Array(128 * 128);
const _whiteLut = new Float32Array(16 * 16);
const _vorF1Grid = new Float32Array(256 * 256);
const _vorEdgeGrid = new Float32Array(256 * 256);

function fillFbmField(dst, size, basePeriod, octaves, seed) {
  const gSize = Math.min(size, 128);
  const gMask = gSize - 1;
  const gInv = 1 / gSize;
  for (let y = 0; y < gSize; y++) {
    const v = y * gInv;
    const rowOff = y * gSize;
    for (let x = 0; x < gSize; x++) {
      const u = x * gInv;
      let sum = 0;
      let amp = 0.5;
      let norm = 0;
      let p = basePeriod;
      for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoiseTile(u, v, p, seed + o * 97);
        norm += amp;
        amp *= 0.5;
        p *= 2;
      }
      _fbmGrid[rowOff + x] = sum / norm;
    }
  }
  if (gSize === size) {
    dst.set(_fbmGrid.subarray(0, size * size));
    return;
  }
  const scale = gSize / size;
  for (let y = 0; y < size; y++) {
    const gy = y * scale;
    const y0 = gy | 0;
    const fy = gy - y0;
    const r0 = (y0 & gMask) * gSize;
    const r1 = ((y0 + 1) & gMask) * gSize;
    const dstRow = y * size;
    for (let x = 0; x < size; x++) {
      const gx = x * scale;
      const x0 = gx | 0;
      const fx = gx - x0;
      const c0 = x0 & gMask;
      const c1 = (x0 + 1) & gMask;
      const v00 = _fbmGrid[r0 + c0];
      const v10 = _fbmGrid[r0 + c1];
      const v01 = _fbmGrid[r1 + c0];
      const v11 = _fbmGrid[r1 + c1];
      const vx0 = v00 + (v10 - v00) * fx;
      const vx1 = v01 + (v11 - v01) * fx;
      dst[dstRow + x] = vx0 + (vx1 - vx0) * fy;
    }
  }
}

function fillWhiteField(dst, size, freqX, freqY, seed) {
  for (let cy = 0; cy < 16; cy++) {
    for (let cx = 0; cx < 16; cx++) {
      _whiteLut[cy * 16 + cx] = hash2(cx, cy, seed);
    }
  }
  const scaleX = (freqX * 16) / size;
  const scaleY = (freqY * 16) / size;
  for (let y = 0; y < size; y++) {
    const gy = y * scaleY;
    const y0 = gy | 0;
    const fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    const r0 = (y0 & 15) * 16;
    const r1 = ((y0 + 1) & 15) * 16;
    const rowOff = y * size;
    for (let x = 0; x < size; x++) {
      const gx = x * scaleX;
      const x0 = gx | 0;
      const fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const c0 = x0 & 15;
      const c1 = (x0 + 1) & 15;
      const n00 = _whiteLut[r0 + c0];
      const n10 = _whiteLut[r0 + c1];
      const n01 = _whiteLut[r1 + c0];
      const n11 = _whiteLut[r1 + c1];
      const nx0 = n00 + (n10 - n00) * sx;
      const nx1 = n01 + (n11 - n01) * sx;
      dst[rowOff + x] = nx0 + (nx1 - nx0) * sy;
    }
  }
}

// Operador MaterialCraft: Directional Blur periódico en retícula entera (directional_blur.rs)
function directionalBlurField(src, dst, size, stepX, stepY, halfSamples) {
  const mask = size - 1;
  let wNorm = 0;
  for (let k = -halfSamples; k <= halfSamples; k++) {
    wNorm += 1 - Math.abs(k) / (halfSamples + 1.5);
  }
  const invNorm = 1 / wNorm;
  for (let y = 0; y < size; y++) {
    const rowOff = y * size;
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -halfSamples; k <= halfSamples; k++) {
        const w = 1 - Math.abs(k) / (halfSamples + 1.5);
        const sx = (x + k * stepX) & mask;
        const sy = (y + k * stepY) & mask;
        acc += src[sy * size + sx] * w;
      }
      dst[rowOff + x] = acc * invNorm;
    }
  }
}

function sampleFieldBilinear(field, size, u, v) {
  const mask = size - 1;
  const px = u * size;
  const py = v * size;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const ix0 = x0 & mask;
  const iy0 = (y0 & mask) * size;
  const ix1 = (x0 + 1) & mask;
  const iy1 = ((y0 + 1) & mask) * size;
  const v00 = field[iy0 + ix0];
  const v10 = field[iy0 + ix1];
  const v01 = field[iy1 + ix0];
  const v11 = field[iy1 + ix1];
  const vx0 = v00 + (v10 - v00) * fx;
  const vx1 = v01 + (v11 - v01) * fx;
  return vx0 + (vx1 - vx0) * fy;
}

// Operador MaterialCraft: Slope Warp periódico invariante a resolución (warp.rs)
function slopeWarpedUV(gradField, size, x, y, u, v, intensity) {
  const mask = size - 1;
  const xm = (x - 1) & mask;
  const xp = (x + 1) & mask;
  const ym = ((y - 1) & mask) * size;
  const yp = ((y + 1) & mask) * size;
  const yc = y * size;
  const scale = intensity * (size / 256);
  const gx = (gradField[yc + xp] - gradField[yc + xm]) * scale;
  const gy = (gradField[yp + x] - gradField[ym + x]) * scale;
  let wu = (u + gx) % 1;
  let wv = (v + gy) % 1;
  if (wu < 0) wu += 1;
  if (wv < 0) wv += 1;
  _u0 = wu;
  _v0 = wv;
}

// Operador MaterialCraft: Directional Warp periódico (directional_warp.rs)
function directionalWarpedUV(u, v, mapVal, angle, intensity) {
  const shift = (mapVal - 0.5) * (intensity / 256);
  let wu = (u + Math.cos(angle) * shift) % 1;
  let wv = (v + Math.sin(angle) * shift) % 1;
  if (wu < 0) wu += 1;
  if (wv < 0) wv += 1;
  _u0 = wu;
  _v0 = wv;
}

function buildVoronoiPoints(cells, seed) {
  const pts = new Float32Array(cells * cells * 2);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const idx = (cy * cells + cx) * 2;
      pts[idx] = 0.12 + hash2(cx, cy, seed) * 0.76;
      pts[idx + 1] = 0.12 + hash2(cx, cy, seed + 31) * 0.76;
    }
  }
  return pts;
}

function evalVoronoiF1F2(pts, cells, u, v) {
  const gx = u * cells;
  const gy = v * cells;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let d1Sq = 64;
  let d2Sq = 64;
  for (let dy = -1; dy <= 1; dy++) {
    let cy = (iy + dy) % cells;
    if (cy < 0) cy += cells;
    const rowOff = cy * cells;
    for (let dx = -1; dx <= 1; dx++) {
      let cx = (ix + dx) % cells;
      if (cx < 0) cx += cells;
      const pIdx = (rowOff + cx) * 2;
      const ddx = gx - (ix + dx + pts[pIdx]);
      const ddy = gy - (iy + dy + pts[pIdx + 1]);
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < d1Sq) {
        d2Sq = d1Sq;
        d1Sq = d2;
      } else if (d2 < d2Sq) {
        d2Sq = d2;
      }
    }
  }
  const f1 = Math.sqrt(d1Sq);
  const f2 = Math.sqrt(d2Sq);
  _f1 = f1 > 1 ? 1 : f1;
  const diff = f2 - f1;
  _fEdge = diff > 1 ? 1 : diff < 0 ? 0 : diff;
}

function fillVoronoiFields(dstF1, dstEdge, size, cells, seed) {
  const pts = buildVoronoiPoints(cells, seed);
  const gSize = Math.min(size, 256);
  const gMask = gSize - 1;
  const gInv = 1 / gSize;
  for (let y = 0; y < gSize; y++) {
    const v = y * gInv;
    const rowOff = y * gSize;
    for (let x = 0; x < gSize; x++) {
      evalVoronoiF1F2(pts, cells, x * gInv, v);
      _vorF1Grid[rowOff + x] = _f1;
      _vorEdgeGrid[rowOff + x] = _fEdge;
    }
  }
  if (gSize === size) {
    const n = size * size;
    dstF1.set(_vorF1Grid.subarray(0, n));
    if (dstEdge) dstEdge.set(_vorEdgeGrid.subarray(0, n));
    return;
  }
  const scale = gSize / size;
  for (let y = 0; y < size; y++) {
    const gy = y * scale;
    const y0 = gy | 0;
    const fy = gy - y0;
    const r0 = (y0 & gMask) * gSize;
    const r1 = ((y0 + 1) & gMask) * gSize;
    const dstRow = y * size;
    for (let x = 0; x < size; x++) {
      const gx = x * scale;
      const x0 = gx | 0;
      const fx = gx - x0;
      const c0 = x0 & gMask;
      const c1 = (x0 + 1) & gMask;
      const a00 = _vorF1Grid[r0 + c0], a10 = _vorF1Grid[r0 + c1];
      const a01 = _vorF1Grid[r1 + c0], a11 = _vorF1Grid[r1 + c1];
      dstF1[dstRow + x] = (a00 + (a10 - a00) * fx) * (1 - fy) + (a01 + (a11 - a01) * fx) * fy;
      if (dstEdge) {
        const e00 = _vorEdgeGrid[r0 + c0], e10 = _vorEdgeGrid[r0 + c1];
        const e01 = _vorEdgeGrid[r1 + c0], e11 = _vorEdgeGrid[r1 + c1];
        dstEdge[dstRow + x] = (e00 + (e10 - e00) * fx) * (1 - fy) + (e01 + (e11 - e01) * fx) * fy;
      }
    }
  }
}

export function createBakeScratch(size) {
  const nPx = size * size;
  return {
    size,
    height: new Float32Array(nPx),
    rough: new Float32Array(nPx),
    metal: new Float32Array(nPx),
    wear: new Float32Array(nPx),
    baseR: new Float32Array(nPx),
    baseG: new Float32Array(nPx),
    baseB: new Float32Array(nPx),
    fieldA: new Float32Array(nPx),
    fieldB: new Float32Array(nPx),
    fieldC: new Float32Array(nPx),
    fieldD: new Float32Array(nPx),
    fieldE: new Float32Array(nPx),
  };
}

const ARCHETYPE_PARAMS = {
  wood_parquet:       { normalStrength: 2.8, aoStrength: 1.35 },
  ceramic_tile:       { normalStrength: 3.1, aoStrength: 1.45 },
  concrete_service:   { normalStrength: 2.7, aoStrength: 1.30 },
  plaster_wall:       { normalStrength: 1.8, aoStrength: 1.05 },
  brushed_steel:      { normalStrength: 1.9, aoStrength: 1.15 },
  painted_metal:      { normalStrength: 2.5, aoStrength: 1.40 },
  fabric_suit:        { normalStrength: 2.1, aoStrength: 1.15 },
  leather_upholstery: { normalStrength: 2.6, aoStrength: 1.35 },
  turf_garden:        { normalStrength: 3.2, aoStrength: 1.50 },
};

export function bakeArchetypeBuffers(kind, size, scratch = null) {
  const sc = scratch && scratch.size === size ? scratch : createBakeScratch(size);
  const { height, rough, metal, wear, baseR, baseG, baseB, fieldA, fieldB, fieldC, fieldD, fieldE } = sc;
  const nPx = size * size;
  const mask = size - 1;
  const inv = 1 / size;
  const blurScale = Math.max(1, size >> 8);

  if (kind === 'wood_parquet') {
    fillFbmField(fieldA, size, 8, 4, 17);
    fillWhiteField(fieldC, size, 2, 24, 41);
    directionalBlurField(fieldC, fieldB, size, 0, 2 * blurScale, 5);
  } else if (kind === 'ceramic_tile') {
    fillFbmField(fieldA, size, 6, 4, 103);
    fillFbmField(fieldB, size, 16, 3, 157);
  } else if (kind === 'concrete_service') {
    fillFbmField(fieldA, size, 6, 4, 211);
    fillFbmField(fieldB, size, 20, 3, 233);
    fillVoronoiFields(fieldC, fieldD, size, 24, 241);
  } else if (kind === 'plaster_wall') {
    fillFbmField(fieldA, size, 6, 4, 307);
    fillWhiteField(fieldB, size, 4, 4, 317);
  } else if (kind === 'brushed_steel') {
    fillWhiteField(fieldC, size, 2, 28, 401);
    directionalBlurField(fieldC, fieldA, size, 2 * blurScale, 0, 6);
    fillWhiteField(fieldC, size, 3, 32, 419);
    directionalBlurField(fieldC, fieldB, size, 2 * blurScale, blurScale, 4);
    fillFbmField(fieldC, size, 4, 3, 431);
  } else if (kind === 'painted_metal') {
    fillFbmField(fieldA, size, 10, 4, 503);
    fillFbmField(fieldB, size, 24, 3, 521);
  } else if (kind === 'fabric_suit') {
    fillFbmField(fieldA, size, 5, 3, 601);
    fillWhiteField(fieldB, size, 4, 4, 619);
  } else if (kind === 'leather_upholstery') {
    fillFbmField(fieldA, size, 6, 3, 701);
    fillVoronoiFields(fieldB, fieldC, size, 22, 709);
    fillVoronoiFields(fieldD, null, size, 46, 719);
  } else {
    fillWhiteField(fieldE, size, 12, 12, 809);
    directionalBlurField(fieldE, fieldA, size, blurScale, 2 * blurScale, 4);
    fillWhiteField(fieldE, size, 14, 14, 821);
    directionalBlurField(fieldE, fieldB, size, -blurScale, 2 * blurScale, 4);
    fillFbmField(fieldC, size, 6, 3, 853);
  }

  for (let y = 0; y < size; y++) {
    const v = y * inv;
    const rowOff = y * size;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const idx = rowOff + x;
      let r = 0.5, g = 0.5, b = 0.5, h = 0.5, rg = 0.5, mt = 0.0, wp = 0.25;

      if (kind === 'wood_parquet') {
        slopeWarpedUV(fieldA, size, x, y, u, v, 0.35);
        const wu = _u0, wv = _v0;
        const rows = 6;
        const cols = 2;
        const row = Math.floor(wv * rows);
        const uShift = (wu + (row & 1) * 0.5) % 1;
        const colIdx = Math.floor(uShift * cols);
        const lux = (uShift * cols) % 1;
        const luy = (wv * rows) % 1;

        const plankRnd = hash2(colIdx, row, 53);
        const tiltX = hash2(colIdx, row, 71) - 0.5;
        const tiltY = hash2(colIdx, row, 89) - 0.5;
        const edgeDist = Math.min(Math.min(lux, 1 - lux) / cols, Math.min(luy, 1 - luy) / rows) * 6;
        const bevel = smoothstep(0.018, 0.068, edgeDist);
        const seamMask = smoothstep(0.012, 0.032, edgeDist);

        const fVal = fieldA[idx];
        directionalWarpedUV(uShift, (v * 2 + plankRnd) % 1, fVal, 1.57, 18);
        const fu = _u0;
        let cathedral = Math.sin((fu * 16 + fVal * 4.2) * Math.PI) * 0.5 + 0.5;
        cathedral = mcLevels(cathedral, 0.08, 0.44, 0.94, 0, 1);
        const porePit = mcLevels(fieldB[idx], 0.20, 0.38, 0.62, 0, 1);

        const plankTone = 0.80 + plankRnd * 0.32;
        const mixW = cathedral * 0.72 + porePit * 0.28;
        const wr = (0.27 + (0.49 - 0.27) * mixW) * plankTone;
        const wg = (0.16 + (0.31 - 0.16) * mixW) * plankTone;
        const wb = (0.09 + (0.18 - 0.09) * mixW) * plankTone;

        const tiltH = (tiltX * (lux - 0.5) + tiltY * (luy - 0.5)) * 0.11;
        r = 0.08 + (wr - 0.08) * seamMask;
        g = 0.05 + (wg - 0.05) * seamMask;
        b = 0.035 + (wb - 0.035) * seamMask;
        h = 0.06 + (0.58 + cathedral * 0.09 + porePit * 0.08 + plankRnd * 0.07 + tiltH - 0.06) * bevel;
        rg = 0.90 + (0.26 + (1 - cathedral) * 0.16 + (1 - porePit) * 0.10 - 0.90) * bevel;
        mt = 0.0;
        wp = 0.35;
      } else if (kind === 'ceramic_tile') {
        const tiles = 4;
        slopeWarpedUV(fieldA, size, x, y, u, v, 0.42);
        const su = _u0, sv = _v0;
        const cx = Math.floor(su * tiles);
        const cy = Math.floor(sv * tiles);
        const lux = (su * tiles) % 1;
        const luy = (sv * tiles) % 1;
        const slabRnd = hash2(cx, cy, 109);
        const tiltX = hash2(cx, cy, 127) - 0.5;
        const tiltY = hash2(cx, cy, 139) - 0.5;

        const edge = Math.min(lux, 1 - lux, luy, 1 - luy);
        const groutMask = smoothstep(0.022, 0.040, edge);
        const bevel = smoothstep(0.022, 0.078, edge);

        const cloud = sampleFieldBilinear(fieldA, size, (u + slabRnd * 0.37) % 1, (v + slabRnd * 0.61) % 1);
        directionalWarpedUV(u, v, cloud, 0.68, 28);
        const vu = _u0, vv = _v0;
        const veinPrimary = Math.pow(Math.max(1e-6, 1 - Math.abs(Math.sin((vu * 2 + vv * 2 + cloud * 0.85) * Math.PI))), 9);
        const veinFine = Math.pow(Math.max(1e-6, 1 - Math.abs(Math.sin((vu * 5 - vv * 3 + cloud * 1.3) * Math.PI))), 14);

        const toneMul = 0.93 + slabRnd * 0.12;
        let sr = (0.23 + 0.13 * cloud) * toneMul;
        let sg = (0.26 + 0.14 * cloud) * toneMul;
        let sb = (0.30 + 0.15 * cloud) * toneMul;
        sr += (0.58 - sr) * veinPrimary * 0.65;
        sg += (0.65 - sg) * veinPrimary * 0.65;
        sb += (0.70 - sb) * veinPrimary * 0.65;
        sr += (0.14 - sr) * veinFine * 0.45;
        sg += (0.18 - sg) * veinFine * 0.45;
        sb += (0.22 - sb) * veinFine * 0.45;

        const gGrain = fieldB[idx];
        const gr = 0.10 * (0.85 + gGrain * 0.3);
        const gg = 0.115 * (0.85 + gGrain * 0.3);
        const gb = 0.135 * (0.85 + gGrain * 0.3);

        const tiltH = (tiltX * (lux - 0.5) + tiltY * (luy - 0.5)) * 0.08;
        r = gr + (sr - gr) * groutMask;
        g = gg + (sg - gg) * groutMask;
        b = gb + (sb - gb) * groutMask;
        h = (0.06 + gGrain * 0.05) + (0.62 + cloud * 0.05 - veinFine * 0.04 + tiltH - 0.08) * bevel;
        rg = 0.92 + (0.14 + cloud * 0.12 + veinFine * 0.08 - 0.92) * groutMask;
        mt = 0.05 * groutMask;
        wp = 0.28;
      } else if (kind === 'concrete_service') {
        slopeWarpedUV(fieldA, size, x, y, u, v, 0.65);
        const jx = (_u0 * 2) % 1;
        const jy = (_v0 * 2) % 1;
        const jEdge = Math.min(jx, 1 - jx, jy, 1 - jy);
        const joint = smoothstep(0.010, 0.032, jEdge);

        const macro = fieldA[idx];
        const meso = fieldB[idx];
        const bugHoles = 1 - mcLevels(fieldC[idx], 0.06, 0.16, 0.24, 0, 1);
        const hairline = 1 - smoothstep(0, 0.035, fieldD[idx]);

        const tone = 0.25 + macro * 0.11 + (meso - 0.5) * 0.07 - bugHoles * 0.10 - hairline * 0.04;
        const jShade = 0.55 + 0.45 * joint;
        r = tone * 0.95 * jShade;
        g = tone * 0.99 * jShade;
        b = tone * 1.05 * jShade;
        h = 0.10 + (0.56 + macro * 0.18 + meso * 0.12 - bugHoles * 0.34 - hairline * 0.10 - 0.10) * joint;
        rg = clamp01(0.74 + (1 - macro) * 0.14 + bugHoles * 0.12 + (1 - joint) * 0.18);
        mt = 0.02;
        wp = 0.42;
      } else if (kind === 'plaster_wall') {
        directionalWarpedUV(u, v, fieldA[idx], 0.42, 22);
        const trowel = sampleFieldBilinear(fieldA, size, _u0, _v0);
        const fineSand = fieldB[idx];
        const rx = (u * 2) % 1;
        const reveal = smoothstep(0.008, 0.022, Math.min(rx, 1 - rx));

        const tone = 0.33 + trowel * 0.08 + (fineSand - 0.5) * 0.035;
        const rShade = 0.68 + 0.32 * reveal;
        r = tone * 0.91 * rShade;
        g = tone * 0.98 * rShade;
        b = tone * 1.10 * rShade;
        h = 0.22 + (0.54 + trowel * 0.20 + fineSand * 0.07 - 0.22) * reveal;
        rg = 0.88 + (0.58 + (1 - trowel) * 0.20 - 0.88) * reveal;
        mt = 0.03;
        wp = 0.22;
      } else if (kind === 'brushed_steel') {
        const streak = fieldA[idx] * 0.72 + fieldB[idx] * 0.28;
        const sheen = fieldC[idx];
        const px = (u * 2) % 1;
        const seam = smoothstep(0.006, 0.018, Math.min(px, 1 - px));

        const base = 0.62 + streak * 0.20 + (sheen - 0.5) * 0.06;
        const sMul = 0.45 + 0.55 * seam;
        r = base * 0.94 * sMul;
        g = base * 0.99 * sMul;
        b = base * 1.05 * sMul;
        h = 0.18 + (0.52 + streak * 0.26 + sheen * 0.06 - 0.18) * seam;
        rg = 0.65 + (0.17 + (1 - streak) * 0.19 - 0.65) * seam;
        mt = 0.55 + 0.38 * seam;
        wp = 0.78;
      } else if (kind === 'painted_metal') {
        const pux = (u * 2) % 1;
        const puy = (v * 2) % 1;
        const edge = Math.min(pux, 1 - pux, puy, 1 - puy);
        const plateBevel = smoothstep(0.016, 0.048, edge);

        const cx = Math.abs(pux - 0.5) - 0.41;
        const cy = Math.abs(puy - 0.5) - 0.41;
        const rivetDist = Math.sqrt(cx * cx + cy * cy);
        const rivetCup = 1 - smoothstep(0.018, 0.032, rivetDist);
        const rivetHead = 1 - smoothstep(0.009, 0.016, rivetDist);

        const grunge = fieldA[idx];
        const peel = fieldB[idx];
        const base = 0.28 + peel * 0.05 + (grunge - 0.5) * 0.05;
        let cr = 0.10 + (base * 0.93 - 0.10) * plateBevel;
        let cg = 0.12 + (base * 1.00 - 0.12) * plateBevel;
        let cb = 0.15 + (base * 1.09 - 0.15) * plateBevel;
        cr += (0.46 - cr) * rivetHead * 0.65;
        cg += (0.50 - cg) * rivetHead * 0.65;
        cb += (0.55 - cb) * rivetHead * 0.65;
        r = cr; g = cg; b = cb;

        h = 0.14 + (0.58 + peel * 0.08 + grunge * 0.06 - 0.14) * plateBevel - rivetCup * 0.22 + rivetHead * 0.16;
        rg = 0.72 + (0.30 + peel * 0.14 + (1 - grunge) * 0.10 - 0.72) * plateBevel;
        mt = Math.max(0.75 + (0.48 - 0.75) * plateBevel, rivetHead * 0.88);
        wp = 0.95;
      } else if (kind === 'fabric_suit') {
        const macroFold = fieldA[idx];
        const fuzz = fieldB[idx];
        directionalWarpedUV(u, v, macroFold, 0.78, 10);
        const du = _u0, dv = _v0;
        const zig = Math.abs(((du * 16) % 1) - 0.5) * 2;
        const threadA = Math.sin((du * 96 + zig * 3.14159 + dv * 96) * Math.PI);
        const threadB = Math.sin((du * 96 - dv * 96) * Math.PI);
        const weave = (threadA * 0.65 + threadB * 0.35) * 0.5 + 0.5;

        const lum = 0.72 + weave * 0.12 + (macroFold - 0.5) * 0.14 + (fuzz - 0.5) * 0.04;
        r = lum * 0.99;
        g = lum * 0.99;
        b = lum * 1.03;
        h = 0.42 + weave * 0.28 + macroFold * 0.18 + fuzz * 0.06;
        rg = 0.82 - weave * 0.14 + (1 - macroFold) * 0.08;
        mt = 0.02;
        wp = 0.18;
      } else if (kind === 'leather_upholstery') {
        slopeWarpedUV(fieldA, size, x, y, u, v, 0.45);
        const pebF1 = sampleFieldBilinear(fieldB, size, _u0, _v0);
        const pebEdge = sampleFieldBilinear(fieldC, size, _u0, _v0);
        const micF1 = fieldD[idx];
        const macro = fieldA[idx];

        const crease = smoothstep(0, 0.14, pebEdge);
        const crown = clamp01(1 - pebF1 * 0.85) * crease;
        const pore = smoothstep(0.06, 0.18, micF1);

        const base = 0.48 + crown * 0.22 + (macro - 0.5) * 0.10;
        const cShade = 0.78 + 0.22 * crease;
        r = base * 1.06 * cShade;
        g = base * 0.91 * cShade;
        b = base * 0.89 * cShade;
        h = 0.22 + crown * 0.52 * (0.85 + 0.15 * pore) + macro * 0.12;
        rg = 0.58 - crown * 0.24 + (1 - pore) * 0.10;
        mt = 0.04;
        wp = 0.38;
      } else {
        const bladesRaw = Math.max(fieldA[idx], fieldB[idx] * 0.95);
        const blades = mcLevels(bladesRaw, 0.24, 0.48, 0.84, 0, 1);
        const patch = fieldC[idx];
        const pTone = 0.82 + patch * 0.34;
        const br = (0.12 + 0.12 * blades) * pTone;
        const bg = (0.25 + 0.19 * blades) * pTone;
        const bb = (0.14 + 0.09 * blades) * pTone;
        const bMask = smoothstep(0.08, 0.35, blades);
        r = 0.08 + (br - 0.08) * bMask;
        g = 0.11 + (bg - 0.11) * bMask;
        b = 0.07 + (bb - 0.07) * bMask;
        h = 0.14 + blades * 0.72 + patch * 0.12;
        rg = 0.94 + (0.68 + (1 - blades) * 0.18 - 0.94) * blades;
        mt = 0.0;
        wp = 0.12;
      }

      height[idx] = clamp01(h);
      rough[idx] = clamp01(rg);
      metal[idx] = clamp01(mt);
      wear[idx] = wp;
      baseR[idx] = clamp01(r);
      baseG[idx] = clamp01(g);
      baseB[idx] = clamp01(b);
    }
  }

  const albedoBuf = new Uint8Array(nPx * 4);
  const ormBuf = new Uint8Array(nPx * 4);
  const normalBuf = new Uint8Array(nPx * 4);

  const cfg = ARCHETYPE_PARAMS[kind] || ARCHETYPE_PARAMS.concrete_service;
  const sobelScale = (cfg.normalStrength * 0.25) * (size / 256);
  const aoStrength = cfg.aoStrength;
  const stepUnit = Math.max(1, size >> 8);
  const dFine = stepUnit;
  const dWide = stepUnit * 3;
  const dirsX = [1, -1, 0, 0, 1, -1, 1, -1];
  const dirsY = [0, 0, 1, -1, 1, 1, -1, -1];
  const dirLen = [1, 1, 1, 1, 1.41421356, 1.41421356, 1.41421356, 1.41421356];

  for (let y = 0; y < size; y++) {
    const ym1 = ((y - 1) & mask) * size;
    const yc = y * size;
    const yp1 = ((y + 1) & mask) * size;

    const yFineM = ((y - dFine) & mask) * size;
    const yFineP = ((y + dFine) & mask) * size;
    const yWideM = ((y - dWide) & mask) * size;
    const yWideP = ((y + dWide) & mask) * size;

    for (let x = 0; x < size; x++) {
      const idx = yc + x;
      const o4 = idx * 4;
      const hC = height[idx];

      // 1. Sobel 3x3 Normal (normal.rs con escalado BASE_RESOLUTION = 256)
      const xm1 = (x - 1) & mask;
      const xp1 = (x + 1) & mask;
      const h00 = height[ym1 + xm1], h10 = height[ym1 + x], h20 = height[ym1 + xp1];
      const h01 = height[yc  + xm1],                        h21 = height[yc  + xp1];
      const h02 = height[yp1 + xm1], h12 = height[yp1 + x], h22 = height[yp1 + xp1];

      const gx = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02);
      const gy = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20);
      const nx = -gx * sobelScale;
      const ny = -gy * sobelScale;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      normalBuf[o4]     = ((nx * invLen * 0.5 + 0.5) * 255 + 0.5) | 0;
      normalBuf[o4 + 1] = ((ny * invLen * 0.5 + 0.5) * 255 + 0.5) | 0;
      normalBuf[o4 + 2] = ((invLen * 0.5 + 0.5) * 255 + 0.5) | 0;
      normalBuf[o4 + 3] = 255;

      // 2. Horizon-Based Ambient Occlusion (8 direcciones x 2 anillos, sin sqrt por dirección)
      let occ = 0;
      const r1 = stepUnit * 2;
      const r2 = stepUnit * 5;
      for (let d = 0; d < 8; d++) {
        const dx = dirsX[d];
        const dy = dirsY[d];
        const invB1 = 2.25 / dirLen[d];
        const invB2 = 0.90 / dirLen[d];
        const s1 = (height[((y + dy * r1) & mask) * size + ((x + dx * r1) & mask)] - hC) * invB1;
        const s2 = (height[((y + dy * r2) & mask) * size + ((x + dx * r2) & mask)] - hC) * invB2;
        const maxSlope = s1 > s2 ? (s1 > 0 ? s1 : 0) : (s2 > 0 ? s2 : 0);
        if (maxSlope > 0) occ += maxSlope / (1 + 0.55 * maxSlope);
      }
      const hbao = clamp01(Math.max(0.08, 1 - (occ * 0.125) * aoStrength));

      // 3. Curvatura multiescala + Desgaste de bordes y suciedad de cavidad
      const lapFine = 4 * hC
        - height[yc + ((x - dFine) & mask)] - height[yc + ((x + dFine) & mask)]
        - height[yFineM + x] - height[yFineP + x];
      const lapWide = 4 * hC
        - height[yc + ((x - dWide) & mask)] - height[yc + ((x + dWide) & mask)]
        - height[yWideM + x] - height[yWideP + x];
      const curv = lapFine * 2.4 + lapWide * 1.3;

      const wp = wear[idx];
      const gr = fieldA[((y * 2) & mask) * size + ((x * 2) & mask)];
      const edgeMask = clamp01(curv * (1.6 + wp * 2.2) * (0.45 + gr * 0.95));
      const cavityMask = clamp01((-curv * 2.2 + (1 - hbao) * 0.65) * (0.55 + (1 - gr) * 0.65));

      let cr = baseR[idx] * (1 - cavityMask * 0.36);
      let cg = baseG[idx] * (1 - cavityMask * 0.36);
      let cb = baseB[idx] * (1 - cavityMask * 0.36);
      const wearBlend = edgeMask * (0.28 + wp * 0.52);
      const wr = wp > 0.7 ? 0.74 : baseR[idx] * 1.24 + 0.04;
      const wg = wp > 0.7 ? 0.78 : baseG[idx] * 1.24 + 0.04;
      const wb = wp > 0.7 ? 0.83 : baseB[idx] * 1.24 + 0.04;
      cr += (wr - cr) * wearBlend;
      cg += (wg - cg) * wearBlend;
      cb += (wb - cb) * wearBlend;

      albedoBuf[o4]     = (clamp01(cr) * 255 + 0.5) | 0;
      albedoBuf[o4 + 1] = (clamp01(cg) * 255 + 0.5) | 0;
      albedoBuf[o4 + 2] = (clamp01(cb) * 255 + 0.5) | 0;
      albedoBuf[o4 + 3] = 255;

      const finRough = clamp01(Math.max(0.06, Math.min(0.99, rough[idx] + cavityMask * 0.22 - edgeMask * wp * 0.24)));
      let finMetal = metal[idx];
      if (wp > 0.7) finMetal = clamp01(finMetal + (0.94 - finMetal) * edgeMask * 0.85);
      finMetal = clamp01(finMetal * (1 - cavityMask * 0.45));

      ormBuf[o4]     = (hbao * 255 + 0.5) | 0;
      ormBuf[o4 + 1] = (finRough * 255 + 0.5) | 0;
      ormBuf[o4 + 2] = (finMetal * 255 + 0.5) | 0;
      ormBuf[o4 + 3] = 255;
    }
  }

  return { albedoBuf, ormBuf, normalBuf };
}
