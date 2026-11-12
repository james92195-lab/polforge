export const BASE_HASH = 36;
export const BASE_WATTS = 70;
export const BASE_HEAT = 34;
export const BASE_CAP = 200;
export const HEAT_LIMIT = 74;
export const DUST_PER_MH = 0.0055;
export const PULSE_MS = 6000;
export const PULSE_COOLDOWN_MS = 8000;
export const PULSE_MULT = 1.5;

export type UpgradeId =
  | "edge"
  | "cool"
  | "breaker"
  | "blade"
  | "rack"
  | "firmware";

export type Upgrade = {
  id: UpgradeId;
  name: string;
  blurb: string;
  baseCost: number;
  hash: number;
  watts: number;
  heat: number;
  cap: number;
  cool: number;
  mult: number;
  max: number;
};

export const UPGRADES: Upgrade[] = [
  {
    id: "edge",
    name: "Edge GPU",
    blurb: "Quiet card. Steady hashes.",
    baseCost: 6,
    hash: 22,
    watts: 55,
    heat: 7,
    cap: 0,
    cool: 0,
    mult: 0,
    max: 20,
  },
  {
    id: "cool",
    name: "Cold plate",
    blurb: "Pulls heat off the stack.",
    baseCost: 10,
    hash: 0,
    watts: 8,
    heat: 0,
    cap: 0,
    cool: 9,
    mult: 0,
    max: 6,
  },
  {
    id: "breaker",
    name: "Breaker",
    blurb: "Raises the watt ceiling.",
    baseCost: 14,
    hash: 0,
    watts: 0,
    heat: 0,
    cap: 160,
    cool: 0,
    mult: 0,
    max: 6,
  },
  {
    id: "blade",
    name: "Validator blade",
    blurb: "Dense board. Hungry.",
    baseCost: 40,
    hash: 80,
    watts: 120,
    heat: 11,
    cap: 0,
    cool: 0,
    mult: 0,
    max: 10,
  },
  {
    id: "rack",
    name: "AggLayer rack",
    blurb: "A whole row in one buy.",
    baseCost: 120,
    hash: 240,
    watts: 280,
    heat: 16,
    cap: 0,
    cool: 0,
    mult: 0,
    max: 6,
  },
  {
    id: "firmware",
    name: "Firmware",
    blurb: "Eight percent more hash, and more heat.",
    baseCost: 28,
    hash: 0,
    watts: 0,
    heat: 5,
    cap: 0,
    cool: 0,
    mult: 0.08,
    max: 5,
  },
];

export type Owned = Record<UpgradeId, number>;

export function emptyOwned(): Owned {
  return { edge: 0, cool: 0, breaker: 0, blade: 0, rack: 0, firmware: 0 };
}

export type Derived = {
  rated: number;
  watts: number;
  cap: number;
  targetHeat: number;
  throttle: number;
  effective: number;
  polPerSec: number;
  overPower: boolean;
  overHeat: boolean;
};

export function costOf(upgrade: Upgrade, owned: number): number {
  return Math.round(upgrade.baseCost * 1.22 ** owned * 100) / 100;
}

export function specLine(upgrade: Upgrade): string {
  const parts: string[] = [];
  if (upgrade.hash) parts.push(`+${upgrade.hash} MH/s`);
  if (upgrade.mult) parts.push(`+${Math.round(upgrade.mult * 100)}% hash`);
  if (upgrade.watts) parts.push(`${upgrade.watts} W`);
  if (upgrade.cap) parts.push(`+${upgrade.cap} W cap`);
  if (upgrade.cool) parts.push(`−${upgrade.cool}° heat`);
  if (upgrade.heat) parts.push(`+${upgrade.heat}°`);
  return parts.join(" · ");
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function derive(owned: Owned, heat: number, pulsing: boolean): Derived {
  let hash = BASE_HASH;
  let watts = BASE_WATTS;
  let heatAdd = 0;
  let cap = BASE_CAP;
  let cool = 0;
  let mult = 1;
  for (const upgrade of UPGRADES) {
    const count = owned[upgrade.id];
    hash += upgrade.hash * count;
    watts += upgrade.watts * count;
    heatAdd += upgrade.heat * count;
    cap += upgrade.cap * count;
    cool += upgrade.cool * count;
    mult += upgrade.mult * count;
  }
  const overPower = watts > cap;
  const overHeat = heat > HEAT_LIMIT;
  let throttle = 1;
  if (overPower) throttle *= cap / watts;
  if (overHeat) throttle *= Math.max(0.4, HEAT_LIMIT / heat);
  const rated = hash * mult;
  const boosted = rated * (pulsing ? PULSE_MULT : 1);
  const effective = boosted * throttle;
  const targetHeat = clamp(
    BASE_HEAT +
      heatAdd -
      cool +
      (pulsing ? 7 : 0) +
      (overPower ? (watts - cap) * 0.05 : 0),
    28,
    99,
  );
  return {
    rated,
    watts,
    cap,
    targetHeat,
    throttle,
    effective,
    polPerSec: effective * DUST_PER_MH,
    overPower,
    overHeat,
  };
}

export function blockMean(effective: number, blocks: number): number {
  return (
    Math.max(4.5, 9 * Math.sqrt(BASE_HASH / Math.max(effective, 1))) *
    (1 + blocks * 0.045)
  );
}

export function blockReward(effective: number): number {
  return (
    0.62 *
    (1 + Math.log2(Math.max(effective, BASE_HASH) / BASE_HASH) * 0.4)
  );
}

export function throttleNote(derived: Derived): string | null {
  if (derived.overPower && derived.overHeat) return "Hash is cut. Heat and power are both over.";
  if (derived.overPower) return "Hash is cut. Draw is over the breaker.";
  if (derived.overHeat) return "Hash is cut. The stack is too hot.";
  return null;
}

export function formatPol(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10000) return sign + Math.round(abs).toLocaleString("en-US");
  if (abs >= 1000) {
    return sign + abs.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  if (abs >= 100) return sign + abs.toFixed(1);
  if (abs >= 10) return sign + abs.toFixed(2);
  return sign + abs.toFixed(3);
}

export function formatPrice(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatHash(mh: number): string {
  if (mh >= 1000) return `${(mh / 1000).toFixed(2)} GH/s`;
  if (mh >= 100) return `${mh.toFixed(0)} MH/s`;
  return `${mh.toFixed(1)} MH/s`;
}
