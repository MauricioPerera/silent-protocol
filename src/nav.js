// Rejilla de navegación + A* con suavizado de trayectoria
import { zoneAt } from './level.js';
import { pointInBox } from './mathx.js';

const CELL = 0.6;
const BOUNDS = { x0: -22.6, z0: -18.6, x1: 22.6, z1: 26.6 };
const AGENT_R = 0.36;

export class Nav {
  constructor(boxes, agentRadius = AGENT_R) {
    this.boxes = boxes;
    this.agentRadius = agentRadius;
    this.cols = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / CELL);
    this.rows = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / CELL);
    this.grid = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = BOUNDS.x0 + (c + 0.5) * CELL;
        const z = BOUNDS.z0 + (r + 0.5) * CELL;
        this.grid[r * this.cols + c] = this.walkablePoint(x, z) ? 1 : 0;
      }
    }
  }
  walkablePoint(x, z) {
    if (!zoneAt(x, z)) return false;
    for (const b of this.boxes) {
      if (pointInBox(x, z, b, this.agentRadius)) return false;
    }
    return true;
  }
  cellOf(x, z) {
    const c = Math.floor((x - BOUNDS.x0) / CELL), r = Math.floor((z - BOUNDS.z0) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }
  center(idx) {
    const r = Math.floor(idx / this.cols), c = idx % this.cols;
    return { x: BOUNDS.x0 + (c + 0.5) * CELL, z: BOUNDS.z0 + (r + 0.5) * CELL };
  }
  nearestFree(x, z) {
    const start = this.cellOf(x, z);
    if (start >= 0 && this.grid[start]) return start;
    const c0 = Math.floor((x - BOUNDS.x0) / CELL), r0 = Math.floor((z - BOUNDS.z0) / CELL);
    for (let rad = 1; rad <= 12; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const i = r * this.cols + c;
          if (this.grid[i]) return i;
        }
      }
    }
    return -1;
  }
  lineWalkable(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (CELL * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.walkablePoint(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }
  path(sx, sz, tx, tz) {
    const start = this.nearestFree(sx, sz);
    const goal = this.nearestFree(tx, tz);
    if (start < 0 || goal < 0) return [];
    const goalPt = this.walkablePoint(tx, tz) ? { x: tx, z: tz } : this.center(goal);
    if (start === goal) return [goalPt];
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gc = goal % this.cols, gr = Math.floor(goal / this.cols);
    const h = (i) => {
      const c = i % this.cols, r = Math.floor(i / this.cols);
      const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
      return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
    };
    // heap binario simple
    const heap = [];
    const push = (i, f) => {
      heap.push({ i, f });
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p].f <= heap[k].f) break;
        const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l].f < heap[m].f) m = l;
          if (r < heap.length && heap[r].f < heap[m].f) m = r;
          if (m === k) break;
          const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
        }
      }
      return top;
    };
    g[start] = 0; push(start, h(start));
    let found = false, guard = 0;
    while (heap.length && guard++ < 20000) {
      const { i } = pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === goal) { found = true; break; }
      const c = i % this.cols, r = Math.floor(i / this.cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const j = nr * this.cols + nc;
          if (!this.grid[j] || closed[j]) continue;
          if (dr && dc) {
            if (!this.grid[r * this.cols + nc] || !this.grid[nr * this.cols + c]) continue;
          }
          const cost = g[i] + (dr && dc ? 1.4142 : 1);
          if (cost < g[j]) { g[j] = cost; from[j] = i; push(j, cost + h(j)); }
        }
      }
    }
    if (!found) return [];
    const raw = [];
    let cur = goal;
    while (cur !== -1) { raw.push(this.center(cur)); cur = from[cur]; }
    raw.reverse();
    raw[0] = { x: sx, z: sz };
    raw[raw.length - 1] = goalPt;
    // string pulling
    const out = [];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let far = anchor + 1;
      for (let k = raw.length - 1; k > anchor + 1; k--) {
        if (this.lineWalkable(raw[anchor].x, raw[anchor].z, raw[k].x, raw[k].z)) { far = k; break; }
      }
      out.push(raw[far]);
      anchor = far;
    }
    return out;
  }
}
