// ---------------------------------------------------------------------------
// SILENT PROTOCOL - configuración global, disfraces, objetos, constantes
// ---------------------------------------------------------------------------

export const TICK = 1 / 60;

export const PLAYER = {
  radius: 0.36,
  speedWalk: 3.1,
  speedRun: 5.3,
  speedCrouch: 1.55,
  speedDrag: 1.7,
  integrityMax: 100,
  regenDelay: 6,
  regenRate: 5,
  instinctMax: 100,
  instinctDrain: 13,
  instinctRecharge: 7,
  grabRange: 1.9,
  interactRange: 2.3,
  takedownRange: 1.85,
};

// Zonas: 'public' = cualquier disfraz puede estar sin levantar sospechas.
export const ZONES = [
  { id: 'hall',      name: 'Salón de gala',      rect: [-14, -6, 14, 12],  public: true,  floor: 0x3a2f2a },
  { id: 'patio',     name: 'Terraza y jardín',   rect: [-22, 12, 22, 26],  public: true,  floor: 0x24302a, outdoor: true },
  { id: 'kitchen',   name: 'Cocina',             rect: [-22, -6, -14, 12],  public: false, floor: 0x30343a },
  { id: 'backstage', name: 'Pasillo de servicio',rect: [-22, -12, 22, -6], public: false, floor: 0x2b2f36 },
  { id: 'storage',   name: 'Almacén',            rect: [-22, -18, -10, -12],public: false, floor: 0x2a2b2f },
  { id: 'security',  name: 'Sala de seguridad',  rect: [-10, -18, 4, -12], public: false, floor: 0x232a35 },
  { id: 'office',    name: 'Despacho VIP',       rect: [4, -18, 22, -12],  public: false, floor: 0x33291f },
  { id: 'lab',       name: 'Laboratorio',        rect: [14, -6, 22, 12],    public: false, floor: 0x1f2b30 },
];

// Disfraces. zones = dónde es legal estar. carry = objetos que puedes portar a la vista.
export const OUTFITS = {
  suit: {
    id: 'suit', name: 'Traje de gala', short: 'GALA',
    zones: ['hall', 'patio'], carry: [],
    color: 0x1c2233, accent: 0x93a7c9, skin: 0xd7b49a,
    hint: 'Invitado. Solo zonas públicas. Cualquier arma a la vista es delito.',
  },
  cook: {
    id: 'cook', name: 'Cocinero', short: 'COCINA',
    zones: ['kitchen', 'backstage', 'storage', 'hall', 'patio'], carry: ['poison'],
    color: 0xe9e6dd, accent: 0xc9c3b4, skin: 0xd7b49a,
    hint: 'Acceso a cocina y servicio. El jefe de cocina detecta el impostor.',
  },
  waiter: {
    id: 'waiter', name: 'Camarero', short: 'SERVICIO',
    zones: ['hall', 'kitchen', 'backstage', 'patio', 'storage'], carry: ['poison'],
    color: 0x20242c, accent: 0xe8e4dc, skin: 0xc99b78,
    hint: 'Puedes llevar veneno (bandeja de bebidas). Muévete por el salón sin problemas.',
  },
  guard: {
    id: 'guard', name: 'Guardia de seguridad', short: 'SEGURIDAD',
    zones: ['hall', 'patio', 'kitchen', 'backstage', 'storage', 'security', 'office', 'lab'], carry: ['pistol', 'trap'],
    color: 0x2c3340, accent: 0x4a5566, skin: 0xc99b78,
    hint: 'Acceso total y pistola a la vista legal. El jefe de seguridad te conoce.',
  },
  scientist: {
    id: 'scientist', name: 'Científica', short: 'LAB',
    zones: ['lab', 'backstage', 'storage', 'hall'], carry: ['poison'],
    color: 0xdfe7ea, accent: 0x54c8d8, skin: 0xd7b49a,
    hint: 'Laboratorio y núcleo de datos. La Dra. senior desenmascara impostores.',
  },
  tech: {
    id: 'tech', name: 'Técnico de mantenimiento', short: 'TÉCNICO',
    zones: ['backstage', 'storage', 'lab', 'security', 'kitchen', 'patio'], carry: ['trap'],
    color: 0xc9762c, accent: 0x3b3f46, skin: 0xb9835e,
    hint: 'Puedes portar trampas y sabotear sin levantar sospechas. No entras al salón.',
  },
  vip: {
    id: 'vip', name: 'Anfitrión VIP', short: 'VIP',
    zones: ['hall', 'patio', 'office', 'backstage'], carry: [],
    color: 0x4a1f2c, accent: 0xd8b45c, skin: 0xd7b49a,
    hint: 'Acceso al despacho privado.',
  },
};

export const ITEMS = [
  { id: 'hands',   name: 'Manos',           key: '1', icon: '✋', ammo: Infinity, illegal: false, desc: 'Someter o estrangular por la espalda (E).' },
  { id: 'pistol',  name: 'Pistola silenciada', key: '2', icon: '🔫', ammo: 12, illegal: true, desc: 'Clic para disparar. X la guarda (oculta = legal).' },
  { id: 'garrote', name: 'Cable de fibra',  key: '3', icon: '🧵', ammo: Infinity, illegal: true, desc: 'Eliminación silenciosa por la espalda (E).' },
  { id: 'poison',  name: 'Veneno letal',    key: '4', icon: '🧪', ammo: 2, illegal: false, desc: 'E sobre bebida/comida para envenenar. Muerte accidental.' },
  { id: 'trap',    name: 'Trampa eléctrica',key: '5', icon: '⚡', ammo: 2, illegal: true, desc: 'Clic para colocar en el suelo. Descarga letal al pisarla.' },
  { id: 'coin',    name: 'Moneda',          key: '6', icon: '🪙', ammo: 3, illegal: false, desc: 'Clic para lanzar: distrae a quien la oiga.' },
];

export const ALERT = { CALM: 0, SEARCH: 1, COMBAT: 2 };

export const VISION = {
  range: 15,
  fov: Math.PI * 0.58,     // ~104 grados
  rangeCrouch: 0.72,
  bodyRange: 9,
  hearGun: 7,
  hearRun: 6.5,
  hearCoin: 13,
  hearTrap: 9,
};

export const SUSPECT = {
  trespass: 0.55,      // por segundo, escalado por distancia
  illegalItem: 0.75,
  crime: 2.6,
  jackedIn: 1.35,
  enforcer: 0.7,
  burned: 1.1,
  decay: 0.32,
  suspiciousAt: 0.4,
  compromisedAt: 1,
};

export const CYBER = {
  hackBaseRange: 11.5,
  wallPenalty: 3.5,
  maxLinkRange: 26,
  aimConeCos: 0.94,
  camMaxPan: 0.65,
  unitDrainPerSec: 2.5,
  camLoopDuration: 18,
  unitDisableDuration: 30,
  lureRadius: 11,
  botInteractRange: 2.1,
  emergencyDisconnectAt: 0.45,
  unitRadius: 0.28,
  unitSpeed: 3.4,
  costs: {
    cam_hop: 8,
    lure_ping: 16,
    cam_loop: 22,
    unit_hijack: 25,
    overheat: 45,
  },
  heat: {
    cam_hop: 0.08,
    lure_ping: 0.12,
    cam_loop: 0.20,
    unit_hijack: 0.25,
    overheat: 0.48,
    botCompromised: 0.45,
    decayPerSec: 0.035,
    traceThreshold: 0.65,
    traceDuration: 10,
    evadeRadius: 9,
    postTraceReset: 0.22,
  },
};

export const COLORS = {
  cyan: 0x4fe3d0,
  amber: 0xffb347,
  red: 0xff4d5e,
  gold: 0xffd166,
  green: 0x6ee7a0,
};

export function outfitAllowed(outfitId, zoneId) {
  const o = OUTFITS[outfitId];
  if (!o) return false;
  const z = ZONES.find((zz) => zz.id === zoneId);
  if (!z) return false;
  if (z.public) return true;
  return o.zones.includes(zoneId);
}

export function itemLegal(outfitId, itemId) {
  const o = OUTFITS[outfitId];
  if (!o) return false;
  const it = ITEMS.find((i) => i.id === itemId);
  if (!it || !it.illegal) return true;
  return o.carry.includes(itemId);
}
