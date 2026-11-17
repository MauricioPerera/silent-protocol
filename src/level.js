// ---------------------------------------------------------------------------
// Diseño del nivel: Mansión Aurora (gala corporativa + laboratorio)
// Todo es procedural: muros, mobiliario, interactuables y rutas de los NPC.
// ---------------------------------------------------------------------------
import { ZONES } from './config.js';
import { segBox } from './mathx.js';

const T = 0.4;      // grosor de muro
const WH = 3.2;     // altura de muro

export const WALLS = [];

function pushBox(x0, z0, x1, z1, h = WH) {
  WALLS.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: Math.abs(x1 - x0), d: Math.abs(z1 - z0), h });
}
// muro horizontal (a lo largo de X) con huecos de puerta [[a,b],...]
function wallX(z, x0, x1, gaps = [], h = WH) {
  let cur = x0;
  for (const [a, b] of gaps.slice().sort((p, q) => p[0] - q[0])) {
    if (a > cur) pushBox(cur, z - T / 2, a, z + T / 2, h);
    cur = b;
  }
  if (cur < x1) pushBox(cur, z - T / 2, x1, z + T / 2, h);
}
function wallZ(x, z0, z1, gaps = [], h = WH) {
  let cur = z0;
  for (const [a, b] of gaps.slice().sort((p, q) => p[0] - q[0])) {
    if (a > cur) pushBox(x - T / 2, cur, x + T / 2, a, h);
    cur = b;
  }
  if (cur < z1) pushBox(x - T / 2, cur, x + T / 2, z1, h);
}

// Perímetro
wallX(-18, -22, 22);
wallX(12, -22, 22, [[-4, 4], [-19, -16.5], [16, 19]]);
wallZ(-22, -18, 12);
wallZ(22, -18, 12);
// Pasillo de servicio
wallX(-12, -22, 22, [[-17, -15], [-4, -2], [12, 14]]);
wallX(-6, -22, 22, [[-19, -17], [-8, -6], [4, 6], [17, 19]]);
// Divisiones verticales
wallZ(-14, -6, 12, [[0, 3]]);
wallZ(14, -6, 12, [[-2, 0]]);
wallZ(-10, -18, -12);
wallZ(4, -18, -12);

// Marcos de puerta (decoración + referencia visual)
export const DOORS = [
  { x: -16, z: -12, rot: 0, label: 'Almacén' }, { x: -3, z: -12, rot: 0, label: 'Seguridad' },
  { x: 13, z: -12, rot: 0, label: 'Despacho' }, { x: -18, z: -6, rot: 0, label: 'Cocina' },
  { x: -7, z: -6, rot: 0, label: 'Salón' }, { x: 5, z: -6, rot: 0, label: 'Salón' },
  { x: 18, z: -6, rot: 0, label: 'Laboratorio' }, { x: -14, z: 1.5, rot: Math.PI / 2, label: 'Servicio' },
  { x: 14, z: -1, rot: Math.PI / 2, label: 'Laboratorio' }, { x: 0, z: 12, rot: 0, label: 'Terraza' },
  { x: -17.75, z: 12, rot: 0, label: 'Terraza' }, { x: 17.5, z: 12, rot: 0, label: 'Terraza' },
];

// Conductos bajos exclusivos para unidades robóticas terrestres (sólidos para humanos)
export const VENTS = [
  { id: 'vent_sec',  x: -10.0, z: -14.7,  axis: 'z', span: 1.5, rot: Math.PI / 2, zones: ['storage', 'security'] },
  { id: 'vent_off',  x: 4.0,   z: -15.75, axis: 'z', span: 1.5, rot: Math.PI / 2, zones: ['security', 'office'] },
  { id: 'vent_hall', x: 9.5,   z: -6.0,   axis: 'x', span: 1.5, rot: 0,           zones: ['backstage', 'hall'] },
  { id: 'vent_lab',  x: 14.0,  z: 8.7,    axis: 'z', span: 1.5, rot: Math.PI / 2, zones: ['hall', 'lab'] },
];

// ---------------------------------------------------------------------------
// Mobiliario. solid => colisiona y bloquea la navegación.
// ---------------------------------------------------------------------------
export const PROPS = [];
const P = (kind, x, z, opts = {}) => PROPS.push(Object.assign({ kind, x, z, solid: true }, opts));

// --- Salón de gala ---
P('rug', 0, 4, { w: 11, d: 9, solid: false, color: 0x5a2233 });
P('bar', -11.5, 8, { w: 1.6, d: 6, h: 1.15 });
P('barback', -13.6, 8, { w: 0.5, d: 6, h: 2.2, solid: false });
P('podium', 0, -4.6, { w: 1.6, d: 1, h: 1.2 });
P('buffet', -11, -3, { w: 3, d: 1.2, h: 0.95 });
for (const [tx, tz] of [[-8, 0], [-8, 6], [8, 0], [8, 6], [-3.5, 9.5], [3.5, 9.5]]) {
  P('table', tx, tz, { r: 1.05, h: 0.78, w: 2.1, d: 2.1 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + tx;
    P('chair', tx + Math.cos(a) * 1.6, tz + Math.sin(a) * 1.6, { rot: -a, solid: false, w: 0.5, d: 0.5, h: 0.9 });
  }
}
P('column', -13, -5, { r: 0.45, h: WH, w: 0.9, d: 0.9 });
P('column', 13, -5, { r: 0.45, h: WH, w: 0.9, d: 0.9 });
P('plant', 12.6, 10.6, { r: 0.5, w: 1, d: 1, h: 1.8 });
P('plant', -13, 11, { r: 0.5, w: 1, d: 1, h: 1.8 });
P('chandelier', 0, 3, { solid: false, y: 4.2, r: 1.7 });
P('piano', 11, -3.5, { w: 2.4, d: 1.6, h: 1.1, rot: 0.3 });

// --- Cocina ---
P('counter', -21.2, 0, { w: 1.4, d: 12, h: 0.95 });
P('counter', -18, -5.2, { w: 7, d: 1.4, h: 0.95 });
P('stove', -19, -5.2, { w: 1.8, d: 1.3, h: 1 });
P('island', -18, 1, { w: 3.6, d: 1.8, h: 0.95 });
P('pot', -18, 1, { solid: false, y: 1.05, r: 0.42 });
P('fridge', -15.2, -3.4, { w: 1.4, d: 1.4, h: 2.2 });
P('sink', -21.2, 7.5, { w: 1.4, d: 1.6, h: 0.95 });
P('shelf', -15.2, 8, { w: 1.2, d: 3, h: 2 });
P('counter', -18, 8.5, { w: 3.4, d: 1.6, h: 0.95 });
P('pans', -18, -5.6, { solid: false, y: 2.1 });

// --- Pasillo de servicio ---
P('locker', -13, -11.2, { w: 3, d: 1.2, h: 2.2 });
P('locker', 8, -11.2, { w: 3, d: 1.2, h: 2.2 });
P('crate', -6, -11, { w: 1.6, d: 1.6, h: 1.4 });
P('crate', 16, -11, { w: 1.6, d: 1.6, h: 1.4 });
P('crate', -20, -8, { w: 1.6, d: 1.6, h: 1.4 });
P('winch', -1, -11.6, { w: 0.9, d: 0.5, h: 1.4, solid: false });
P('fusebox', 2, -11.65, { w: 0.8, d: 0.35, h: 1.6, solid: false });
P('toolbox', 11, -11.4, { w: 1.2, d: 0.8, h: 0.7 });
P('bucket', 10, -7, { r: 0.3, w: 0.6, d: 0.6, h: 0.5, solid: false });
P('puddle', -3, -8.5, { r: 1.6, solid: false, color: 0x2a4a55 });

// --- Almacén ---
P('shelf', -20, -15, { w: 1.4, d: 5, h: 2.4 });
P('shelf', -16, -15.8, { w: 1.4, d: 4, h: 2.4 });
P('shelf', -12.5, -16.5, { w: 1.4, d: 2.6, h: 2.4 });
P('freezer', -11.5, -13, { w: 1.6, d: 1.6, h: 2 });
P('crate', -18.5, -17.2, { w: 1.6, d: 1.4, h: 1.4 });

// --- Seguridad ---
P('desk', -3, -16.8, { w: 6, d: 1.4, h: 0.9 });
P('monitors', -3, -17.6, { w: 6, d: 0.4, h: 1.6, solid: false });
P('chair', -3, -15.6, { solid: false, w: 0.6, d: 0.6, h: 1 });
P('locker', 2.6, -14, { w: 1.4, d: 2.4, h: 2.2 });
P('rack', 0.5, -17.4, { w: 1.6, d: 0.5, h: 1.8, solid: false });

// --- Despacho VIP ---
P('desk', 14, -16.4, { w: 4.4, d: 1.8, h: 0.9 });
P('wineglass', 13, -16.2, { solid: false, y: 0.98 });
P('chair', 14, -15, { solid: false, w: 0.6, d: 0.6, h: 1.1 });
P('sofa', 19.5, -14, { w: 2.4, d: 1.2, h: 0.8 });
P('shelf', 21, -16.5, { w: 1.2, d: 4, h: 2.4 });
P('closet', 6, -17, { w: 1.8, d: 1.6, h: 2.3 });
P('rug', 13, -14.2, { w: 6, d: 3, solid: false, color: 0x4a2a20 });
P('plant', 20.5, -12.8, { r: 0.45, w: 0.9, d: 0.9, h: 1.6 });

// --- Laboratorio ---
P('bench', 21.2, 1, { w: 1.4, d: 10, h: 0.95 });
P('bench', 17.5, -3.5, { w: 3.2, d: 1.6, h: 0.95 });
P('coffee', 21.2, -5.2, { w: 1.2, d: 1.2, h: 1.3 });
P('pod', 16, 6.5, { r: 0.8, w: 1.6, d: 1.6, h: 2.4 });
P('pod', 18.6, 6.5, { r: 0.8, w: 1.6, d: 1.6, h: 2.4 });
P('terminal', 15.2, 10.5, { w: 1.6, d: 1.2, h: 1.5 });
P('cryo', 15.2, -4.6, { w: 1.6, d: 1.6, h: 2.1 });
P('puddle', 17.8, 4.5, { r: 1.9, solid: false, color: 0x2a4a55 });
P('fusebox', 21.6, 3.2, { w: 0.35, d: 0.8, h: 1.6, solid: false });
P('vialrack', 20.6, 2, { solid: false, y: 1.0 });

// --- Terraza / jardín ---
P('pool', 10, 19, { w: 12, d: 7, h: 0.3 });
P('hedge', -16, 15, { w: 8, d: 1.2, h: 1.3 });
P('hedge', -21, 22, { w: 1.2, d: 6, h: 1.3 });
P('hedge', 18, 24.5, { w: 7, d: 1.2, h: 1.3 });
P('fountain', -8, 20, { r: 1.6, w: 3.2, d: 3.2, h: 1.2 });
P('lounge', 2, 14.5, { w: 0.8, d: 2, h: 0.5, rot: 0.2 });
P('lounge', 4, 14.5, { w: 0.8, d: 2, h: 0.5, rot: -0.1 });
P('lounge', -2, 14.5, { w: 0.8, d: 2, h: 0.5 });
P('tree', -20.5, 25, { r: 0.6, w: 1.2, d: 1.2, h: 4.5 });
P('tree', 20, 13.6, { r: 0.6, w: 1.2, d: 1.2, h: 4.5 });
P('tree', -13.5, 24, { r: 0.6, w: 1.2, d: 1.2, h: 4.5 });
P('shed', -20.3, 18, { w: 2.4, d: 2.4, h: 2.4 });
P('statue', 0, 17, { r: 0.7, w: 1.4, d: 1.4, h: 2.6 });
P('table', -4, 17.5, { r: 0.8, w: 1.6, d: 1.6, h: 0.75 });
P('boat', 0, 25.6, { w: 5, d: 2.4, h: 1.1, solid: false });
P('dock', 0, 24, { w: 4, d: 3, h: 0.15, solid: false });
for (const v of VENTS) {
  P('vent', v.x, v.z, { ventId: v.id, rot: v.rot, w: 0.9, d: 0.5, h: 0.55, solid: false });
}

// ---------------------------------------------------------------------------
// Interactuables
// ---------------------------------------------------------------------------
export const INTERACTABLES = [
  // contenedores de cuerpos
  { id: 'fridge',   type: 'container', name: 'Nevera industrial', x: -15.2, z: -3.4, useAt: [-16.8, -3.2], cap: 2 },
  { id: 'locker1',  type: 'container', name: 'Taquilla de servicio', x: -13, z: -11.2, useAt: [-13, -9.9], cap: 2 },
  { id: 'locker2',  type: 'container', name: 'Taquilla de servicio', x: 8, z: -11.2, useAt: [8, -9.9], cap: 2 },
  { id: 'freezer',  type: 'container', name: 'Congelador', x: -11.5, z: -13, useAt: [-13.2, -13], cap: 2 },
  { id: 'lockersec',type: 'container', name: 'Taquilla de seguridad', x: 2.6, z: -14, useAt: [1.2, -14], cap: 2 },
  { id: 'closet',   type: 'container', name: 'Armario del despacho', x: 6, z: -17, useAt: [6, -15.6], cap: 2 },
  { id: 'cryo',     type: 'container', name: 'Cápsula criogénica', x: 15.2, z: -4.6, useAt: [16.9, -5.2], cap: 2 },
  { id: 'shed',     type: 'container', name: 'Cobertizo del jardín', x: -20.3, z: 18, useAt: [-18.4, 18], cap: 3 },
  // venenos
  { id: 'wine',   type: 'poison', name: 'Copa de vino del anfitrión', x: 13, z: -16.2, useAt: [13, -14.9], consumer: 'vandermeer' },
  { id: 'coffee', type: 'poison', name: 'Café de la Dra. Kessler', x: 21.2, z: -5.2, useAt: [20.1, -5.2], consumer: 'kessler', hack: 'lure_ping' },
  { id: 'soup',   type: 'poison', name: 'Olla de la cocina', x: -18, z: 1, useAt: [-18, 2.6], consumer: 'cook1' },
  { id: 'punch',  type: 'poison', name: 'Ponchera del bufé', x: -11, z: -3, useAt: [-11, -1.6], consumer: 'guest4' },
  // sabotajes
  { id: 'winch',  type: 'sabotage', sub: 'chandelier', name: 'Torno de la lámpara', x: -1, z: -11.6, useAt: [-1, -10.6], needs: 'tech', hack: 'overheat' },
  { id: 'lights', type: 'sabotage', sub: 'blackout', name: 'Cuadro eléctrico del salón', x: 2, z: -11.65, useAt: [2, -10.6], needs: 'tech', hack: 'overheat' },
  { id: 'labfuse',type: 'sabotage', sub: 'electro', name: 'Cuadro del laboratorio', x: 21.6, z: 3.2, useAt: [19.9, 2.2], needs: 'tech', hack: 'overheat' },
  // señuelo electrónico
  { id: 'piano',  type: 'lure', name: 'Cola automática del piano', x: 11, z: -3.5, useAt: [9.0, -3.5], hack: 'lure_ping' },
  // otros
  { id: 'cams',   type: 'cameras', name: 'Consola de cámaras', x: -3, z: -16.8, useAt: [-3, -15.5], hack: 'lure_ping' },
  { id: 'core',   type: 'intel', name: 'Núcleo de datos Aurora', x: 15.2, z: 10.5, useAt: [15.2, 9.2], hack: 'lure_ping' },
  { id: 'boat',   type: 'extract', name: 'Lancha de extracción', x: 0, z: 24.2, useAt: [0, 23.4] },
  { id: 'ammo',   type: 'pickup', gives: 'pistol', amount: 6, name: 'Munición 9mm', x: 0.5, z: -17.4, useAt: [0.5, -16.6] },
  { id: 'vials',  type: 'pickup', gives: 'poison', amount: 1, name: 'Vial de neurotoxina', x: 20.6, z: 2, useAt: [19.7, 2] },
  { id: 'traps',  type: 'pickup', gives: 'trap', amount: 1, name: 'Carga eléctrica', x: 11, z: -11.4, useAt: [11, -10.4] },
  { id: 'coins',  type: 'pickup', gives: 'coin', amount: 3, name: 'Monedas', x: -11.5, z: 5.6, useAt: [-10.2, 5.6] },
];

// Cámaras de seguridad (visión fija, se desactivan desde la consola)
export const CAMERAS = [
  { id: 'cam_hall', x: -11.6, z: -5.5,  yaw: Math.PI * 0.25,  range: 13, fov: 1.0, zone: 'hall' },
  { id: 'cam_lab',  x: 19.6,  z: -5.5,  yaw: -Math.PI * 0.12, range: 13, fov: 1.0, zone: 'lab' },
  { id: 'cam_corr', x: -8,    z: -11.5, yaw: Math.PI * 0.5,   range: 14, fov: 0.9, zone: 'backstage' },
  { id: 'cam_off',  x: 19.2,  z: -12.6, yaw: -Math.PI * 0.72, range: 12, fov: 1.0, zone: 'office' },
];

// Unidades robóticas autónomas terrestres (aisladas en sim.units)
export const UNIT_DEFS = [
  {
    id: 'bot_maint', name: 'Unidad Auxiliar M-1', kind: 'maint',
    x: -14.2, z: -14.7,
    allowedZones: ['storage', 'backstage', 'kitchen'],
    route: [[-14.2, -14.7, 4], [-14.2, -9.0, 4], [-6.0, -9.0, 4]],
  },
  {
    id: 'bot_sec', name: 'Dron Cuadrúpedo S-2', kind: 'sec',
    x: 16.6, z: 1.5,
    allowedZones: ['lab', 'backstage', 'security'],
    route: [[16.6, 1.5, 4], [16.6, -1.5, 3], [10.5, -9.0, 4]],
  },
];

// ---------------------------------------------------------------------------
// Reparto de NPC. route: [x, z, permanencia(seg), acción?]
// ---------------------------------------------------------------------------
export const NPC_DEFS = [
  {
    id: 'vandermeer', name: 'Marcus Vandermeer', role: 'vip', outfit: 'vip', target: true, speed: 1.5,
    desc: 'CEO de Aurora Dynamics. Objetivo principal.',
    route: [[0, -3.2, 14, 'speech'], [-9.6, 4, 7], [5, 7, 5], [5, -8, 1], [11.6, -13.6, 1], [13, -14.9, 11, 'drink:wine'],
            [17.4, -14, 4], [11.6, -13.6, 1], [5, -8, 1], [0, 2.6, 8], [0, 14.6, 9]],
  },
  {
    id: 'kessler', name: 'Dra. Elena Kessler', role: 'scientist', outfit: 'scientist', target: true, speed: 1.55,
    desc: 'Directora del proyecto Aurora. Objetivo principal.',
    route: [[19.6, -1, 12, 'work'], [20.1, -5.2, 6, 'drink:coffee'], [16.2, 1.5, 3], [17.8, 4.2, 3],
            [18, -8, 1], [-18, -15.5, 7, 'work'], [-14, -9, 1], [18, -8, 1], [17.4, 8.6, 9, 'work']],
  },
  {
    id: 'guard_hall', name: 'Guardia del salón', role: 'guard', outfit: 'guard', speed: 1.7,
    route: [[-8.5, -4, 2], [8.5, -4, 2], [10.5, 9, 2], [-10, 9, 2]],
  },
  {
    id: 'guard_corr', name: 'Guardia de pasillo', role: 'guard', outfit: 'guard', speed: 1.75,
    route: [[-18, -9, 2], [-3, -9, 1], [-3, -14.2, 7, 'work'], [-3, -9, 1], [18, -9, 2], [0, -9, 1]],
  },
  {
    id: 'guard_patio', name: 'Guardia de terraza', role: 'guard', outfit: 'guard', speed: 1.7,
    route: [[-6, 14, 2], [6, 14, 2], [14, 23.6, 3], [-8, 23.5, 2]],
  },
  {
    id: 'guard_office', name: 'Guardia del despacho', role: 'guard', outfit: 'guard', speed: 1.5,
    route: [[13, -13.2, 9, 'look'], [10, -9.5, 4], [13, -13.2, 9, 'look']],
  },
  {
    id: 'chief', name: 'Jefe de seguridad', role: 'guard', outfit: 'guard', speed: 1.5, enforcerFor: 'guard',
    route: [[-3, -14.6, 14, 'work'], [-6.5, -14, 5], [-3, -9.5, 3]],
  },
  {
    id: 'cook1', name: 'Cocinero', role: 'cook', outfit: 'cook', speed: 1.5,
    route: [[-18, 2.6, 8, 'work'], [-19, -4.1, 6, 'work'], [-18, 7, 5, 'work'], [-18, 2.6, 4, 'drink:soup']],
  },
  {
    id: 'chef', name: 'Jefe de cocina', role: 'cook', outfit: 'cook', speed: 1.55, enforcerFor: 'cook',
    route: [[-17, -2.5, 6, 'work'], [-16, -9, 3], [-18, -15.5, 6], [-16, -9, 2], [-18, 4, 5, 'work']],
  },
  {
    id: 'waiter1', name: 'Camarero', role: 'waiter', outfit: 'waiter', speed: 1.85,
    route: [[-6, 3, 3], [-10.2, 6, 5, 'work'], [-15.6, 1.5, 2], [-18, 3.6, 4, 'work'], [-15.6, 1.5, 1], [6, 6, 3]],
  },
  {
    id: 'waiter2', name: 'Camarera de terraza', role: 'waiter', outfit: 'waiter', speed: 1.85,
    route: [[7, 2, 3], [1, 13.5, 2], [-4, 15.2, 4], [2, 22, 4], [1, 13.5, 1], [3, 8, 3]],
  },
  {
    id: 'barkeeper', name: 'Barman', role: 'waiter', outfit: 'waiter', speed: 1.3,
    route: [[-13, 7.5, 16, 'work'], [-13, 9.5, 8, 'work']],
  },
  {
    id: 'sci1', name: 'Científico junior', role: 'scientist', outfit: 'scientist', speed: 1.5,
    route: [[19.4, 5, 9, 'work'], [16.2, -1, 4], [16, -9, 5], [19.4, 5, 6, 'work']],
  },
  {
    id: 'sci_senior', name: 'Dra. Novak (senior)', role: 'scientist', outfit: 'scientist', speed: 1.45, enforcerFor: 'scientist',
    route: [[20, 8.5, 12, 'work'], [16.4, 4, 6], [20, -1.5, 5, 'work']],
  },
  {
    id: 'tech1', name: 'Técnico de mantenimiento', role: 'tech', outfit: 'tech', speed: 1.7,
    route: [[6, -9, 6, 'work'], [-13, -14, 7, 'work'], [16, 9.5, 6, 'work'], [-4, -9, 4]],
  },
  { id: 'guest1', name: 'Invitada', role: 'civilian', outfit: 'suit', speed: 1.4, route: [[-5, 6, 6], [-9, 8.5, 5], [2, 10.5, 7]] },
  { id: 'guest2', name: 'Invitado', role: 'civilian', outfit: 'suit', speed: 1.4, route: [[6, 8, 5], [9.5, 3, 6], [2, 5, 5]] },
  { id: 'guest3', name: 'Invitada de terraza', role: 'civilian', outfit: 'suit', speed: 1.35, route: [[-4.5, 16, 7], [-12, 22, 6], [-2, 23.5, 6]] },
  { id: 'guest4', name: 'Invitado VIP', role: 'civilian', outfit: 'suit', speed: 1.4, route: [[-2, 1, 5], [4, -2, 5], [-11, -1.6, 6, 'drink:punch'], [-7, -2, 4]] },
];

export const PLAYER_SPAWN = { x: 0, z: 23, yaw: Math.PI };

// Luces puntuales ambientales (render)
export const LIGHTS = [
  { x: 0, z: 3, y: 4.0, color: 0xffc98a, intensity: 55, dist: 22 },
  { x: -8, z: 8, y: 3.0, color: 0xffb877, intensity: 22, dist: 14 },
  { x: 8, z: 0, y: 3.0, color: 0xffb877, intensity: 22, dist: 14 },
  { x: -18, z: 1, y: 3.0, color: 0xdfe9ff, intensity: 26, dist: 14 },
  { x: -18, z: 8, y: 3.0, color: 0xdfe9ff, intensity: 18, dist: 12 },
  { x: 0, z: -9, y: 3.0, color: 0x9fb6d8, intensity: 22, dist: 20 },
  { x: -16, z: -9, y: 3.0, color: 0x9fb6d8, intensity: 14, dist: 12 },
  { x: 16, z: -9, y: 3.0, color: 0x9fb6d8, intensity: 14, dist: 12 },
  { x: -3, z: -15, y: 2.8, color: 0x6f9dff, intensity: 20, dist: 12 },
  { x: 13, z: -15, y: 2.8, color: 0xffb060, intensity: 22, dist: 13 },
  { x: 18, z: 1, y: 3.0, color: 0x66e6ff, intensity: 26, dist: 15 },
  { x: 18, z: 8, y: 3.0, color: 0x66e6ff, intensity: 18, dist: 12 },
  { x: -14, z: -15, y: 2.8, color: 0xa8b6c8, intensity: 14, dist: 12 },
  { x: -6, z: 19, y: 3.4, color: 0xffd9a0, intensity: 26, dist: 18 },
  { x: 12, z: 22, y: 3.4, color: 0x8fd8ff, intensity: 24, dist: 18 },
  { x: 0, z: 24.5, y: 2.6, color: 0x4fe3d0, intensity: 18, dist: 10 },
];

export function zoneAt(x, z) {
  for (const zn of ZONES) {
    const [x0, z0, x1, z1] = zn.rect;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return zn.id;
  }
  return null;
}

export function solidBoxes() {
  const out = [];
  for (const w of WALLS) out.push({ x: w.x, z: w.z, hw: w.w / 2, hd: w.d / 2, tall: w.h > 1.5, wall: true });
  for (const p of PROPS) {
    if (!p.solid) continue;
    if (p.kind === 'rug' || p.kind === 'dock') continue;
    const w = p.w || 1, d = p.d || 1;
    const c = Math.abs(Math.cos(p.rot || 0)), s = Math.abs(Math.sin(p.rot || 0));
    out.push({ x: p.x, z: p.z, hw: (w * c + d * s) / 2, hd: (w * s + d * c) / 2, tall: (p.h || 1) > 1.5, prop: p.kind });
  }
  return out;
}

export function solidBoxesForUnits() {
  const out = [];
  for (const w of WALLS) {
    let segs = [{ x0: w.x - w.w / 2, z0: w.z - w.d / 2, x1: w.x + w.w / 2, z1: w.z + w.d / 2, h: w.h }];
    for (const v of VENTS) {
      const next = [];
      for (const s of segs) {
        if (v.axis === 'x' && (s.x1 - s.x0) > (s.z1 - s.z0) && v.z >= s.z0 - 0.05 && v.z <= s.z1 + 0.05) {
          const gx0 = v.x - v.span / 2, gx1 = v.x + v.span / 2;
          if (gx1 <= s.x0 || gx0 >= s.x1) { next.push(s); continue; }
          if (gx0 > s.x0 + 0.02) next.push({ x0: s.x0, z0: s.z0, x1: gx0, z1: s.z1, h: s.h });
          if (s.x1 > gx1 + 0.02) next.push({ x0: gx1, z0: s.z0, x1: s.x1, z1: s.z1, h: s.h });
        } else if (v.axis === 'z' && (s.z1 - s.z0) > (s.x1 - s.x0) && v.x >= s.x0 - 0.05 && v.x <= s.x1 + 0.05) {
          const gz0 = v.z - v.span / 2, gz1 = v.z + v.span / 2;
          if (gz1 <= s.z0 || gz0 >= s.z1) { next.push(s); continue; }
          if (gz0 > s.z0 + 0.02) next.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: gz0, h: s.h });
          if (s.z1 > gz1 + 0.02) next.push({ x0: s.x0, z0: gz1, x1: s.x1, z1: s.z1, h: s.h });
        } else {
          next.push(s);
        }
      }
      segs = next;
    }
    for (const s of segs) {
      out.push({
        x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2,
        hw: (s.x1 - s.x0) / 2, hd: (s.z1 - s.z0) / 2,
        tall: s.h > 1.5, wall: true,
      });
    }
  }
  for (const p of PROPS) {
    if (!p.solid) continue;
    if (p.kind === 'rug' || p.kind === 'dock') continue;
    const w = p.w || 1, d = p.d || 1;
    const c = Math.abs(Math.cos(p.rot || 0)), s = Math.abs(Math.sin(p.rot || 0));
    out.push({ x: p.x, z: p.z, hw: (w * c + d * s) / 2, hd: (w * s + d * c) / 2, tall: (p.h || 1) > 1.5, prop: p.kind });
  }
  return out;
}

export function wallBlocked(ax, az, bx, bz) {
  for (const w of WALLS) {
    const t = segBox(ax, az, bx, bz, { x: w.x, z: w.z, hw: w.w / 2, hd: w.d / 2 });
    if (t >= 0 && t <= 1) return true;
  }
  return false;
}

export function countWallCrossings(ax, az, bx, bz) {
  const segLen = Math.hypot(bx - ax, bz - az);
  if (segLen < 1e-6) return 0;
  const hits = [];
  for (const w of WALLS) {
    const t = segBox(ax, az, bx, bz, { x: w.x, z: w.z, hw: w.w / 2, hd: w.d / 2 });
    if (t >= 0 && t <= 1) hits.push(t * segLen);
  }
  if (!hits.length) return 0;
  hits.sort((a, b) => a - b);
  let count = 1, last = hits[0];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i] - last >= 0.45) {
      count++;
      last = hits[i];
    }
  }
  return count;
}
