import { create } from "zustand";
import {
  BASE_HEAT,
  PULSE_COOLDOWN_MS,
  PULSE_MS,
  UPGRADES,
  blockMean,
  blockReward,
  costOf,
  derive,
  emptyOwned,
  throttleNote,
  type Owned,
  type UpgradeId,
} from "@/lib/mine/model";

const KEY = "polforge-v1";

export type LogItem = { id: number; reward: number; at: number };

type Sim = {
  pol: number;
  earned: number;
  owned: Owned;
  blocks: number;
  heat: number;
  nextId: number;
  log: LogItem[];
  samples: number[];
  pulseUntil: number;
  pulseReadyAt: number;
  shareAcc: number;
  sampleAcc: number;
  blockAcc: number;
};

export type PulseMode = "ready" | "on" | "cool";

export type Snapshot = {
  pol: number;
  earned: number;
  owned: Owned;
  blocks: number;
  heat: number;
  derived: ReturnType<typeof derive>;
  note: string | null;
  mean: number;
  log: LogItem[];
  samples: number[];
  pulseMode: PulseMode;
  pulseSeconds: number;
  pulseRatio: number;
  now: number;
};

export const stage = {
  intensity: 0.35,
  shareSerial: 0,
  blockSerial: 0,
};

function freshSim(): Sim {
  return {
    pol: 0,
    earned: 0,
    owned: emptyOwned(),
    blocks: 0,
    heat: BASE_HEAT,
    nextId: 1,
    log: [],
    samples: [],
    pulseUntil: 0,
    pulseReadyAt: 0,
    shareAcc: 0,
    sampleAcc: 0,
    blockAcc: 0,
  };
}

const sim: Sim = freshSim();

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pulsingAt(now: number): boolean {
  return now < sim.pulseUntil;
}

function buildSnapshot(): Snapshot {
  const now = Date.now();
  const pulsing = pulsingAt(now);
  const derived = derive(sim.owned, sim.heat, pulsing);
  let pulseMode: PulseMode = "ready";
  let pulseSeconds = 0;
  let pulseRatio = 1;
  if (now < sim.pulseUntil) {
    pulseMode = "on";
    pulseSeconds = Math.ceil((sim.pulseUntil - now) / 1000);
    pulseRatio = (sim.pulseUntil - now) / PULSE_MS;
  } else if (now < sim.pulseReadyAt) {
    pulseMode = "cool";
    pulseSeconds = Math.ceil((sim.pulseReadyAt - now) / 1000);
    pulseRatio = (now - sim.pulseUntil) / PULSE_COOLDOWN_MS;
  }
  return {
    pol: sim.pol,
    earned: sim.earned,
    owned: { ...sim.owned },
    blocks: sim.blocks,
    heat: sim.heat,
    derived,
    note: throttleNote(derived),
    mean: blockMean(derived.effective, sim.blocks),
    log: sim.log.slice(),
    samples: sim.samples.slice(),
    pulseMode,
    pulseSeconds,
    pulseRatio: Math.max(0, Math.min(1, pulseRatio)),
    now,
  };
}

export const useMine = create<Snapshot>(() => buildSnapshot());

function publish(): void {
  useMine.setState(buildSnapshot());
}

type Persisted = {
  v: 1;
  pol: number;
  earned: number;
  owned: unknown;
  blocks: number;
  heat: number;
  nextId: number;
  log: LogItem[];
};

function sanitizeOwned(raw: unknown): Owned {
  const owned = emptyOwned();
  if (!raw || typeof raw !== "object") return owned;
  const record = raw as Record<string, unknown>;
  for (const upgrade of UPGRADES) {
    const value = record[upgrade.id];
    if (typeof value === "number" && Number.isFinite(value)) {
      owned[upgrade.id] = Math.max(0, Math.min(upgrade.max, Math.floor(value)));
    }
  }
  return owned;
}

function load(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Persisted;
    if (!data || data.v !== 1) return;
    sim.pol = typeof data.pol === "number" && data.pol >= 0 ? data.pol : 0;
    sim.earned = typeof data.earned === "number" && data.earned >= 0 ? data.earned : sim.pol;
    sim.owned = sanitizeOwned(data.owned);
    sim.blocks = typeof data.blocks === "number" && data.blocks >= 0 ? Math.floor(data.blocks) : 0;
    sim.heat = typeof data.heat === "number" && Number.isFinite(data.heat) ? data.heat : BASE_HEAT;
    sim.nextId = typeof data.nextId === "number" ? Math.max(1, Math.floor(data.nextId)) : 1;
    sim.log = Array.isArray(data.log)
      ? data.log
          .filter(
            (item) =>
              item &&
              typeof item.id === "number" &&
              typeof item.reward === "number" &&
              typeof item.at === "number",
          )
          .slice(0, 6)
      : [];
  } catch {
    /* ignore broken saves */
  }
}

function save(): void {
  if (typeof localStorage === "undefined") return;
  const payload: Persisted = {
    v: 1,
    pol: sim.pol,
    earned: sim.earned,
    owned: sim.owned,
    blocks: sim.blocks,
    heat: sim.heat,
    nextId: sim.nextId,
    log: sim.log,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage full or blocked */
  }
}

function tick(dt: number): void {
  const now = Date.now();
  const pulsing = pulsingAt(now);
  const before = derive(sim.owned, sim.heat, pulsing);
  const k = 1 - Math.exp(-dt * 0.9);
  sim.heat += (before.targetHeat - sim.heat) * k;
  const derived = derive(sim.owned, sim.heat, pulsing);
  const gain = derived.polPerSec * dt;
  sim.pol = round3(sim.pol + gain);
  sim.earned = round3(sim.earned + gain);

  const mean = blockMean(derived.effective, sim.blocks);
  sim.blockAcc += dt;
  if (sim.blockAcc >= 0 && Math.random() < 1 - Math.exp(-dt / mean)) {
    const reward = round3(blockReward(derived.effective));
    sim.pol = round3(sim.pol + reward);
    sim.earned = round3(sim.earned + reward);
    sim.blocks += 1;
    sim.log.unshift({ id: sim.nextId, reward, at: now });
    sim.nextId += 1;
    if (sim.log.length > 6) sim.log.length = 6;
    stage.blockSerial += 1;
  }

  const shareEvery = Math.max(0.16, 0.7 / Math.sqrt(Math.max(derived.effective, 1) / 36));
  sim.shareAcc += dt;
  while (sim.shareAcc >= shareEvery) {
    sim.shareAcc -= shareEvery;
    stage.shareSerial += 1;
  }
  stage.intensity = Math.max(0.35, Math.min(1, derived.effective / 220));

  sim.sampleAcc += dt;
  if (sim.sampleAcc >= 1) {
    sim.sampleAcc = 0;
    sim.samples.push(Math.round(derived.effective * 10) / 10);
    if (sim.samples.length > 40) sim.samples.shift();
  }
}

let lastPublish = 0;
let looping = false;

export function bootMine(): () => void {
  load();
  publish();
  if (looping) return () => {};
  looping = true;
  let last = Date.now();
  const id = window.setInterval(() => {
    const now = Date.now();
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    tick(dt);
    if (now - lastPublish >= 200) {
      lastPublish = now;
      publish();
    }
  }, 100);
  const saveId = window.setInterval(save, 2000);
  const onHide = () => save();
  window.addEventListener("pagehide", onHide);
  return () => {
    looping = false;
    window.clearInterval(id);
    window.clearInterval(saveId);
    window.removeEventListener("pagehide", onHide);
    save();
  };
}

export function buyUpgrade(id: UpgradeId): void {
  const upgrade = UPGRADES.find((item) => item.id === id);
  if (!upgrade) return;
  const count = sim.owned[id];
  if (count >= upgrade.max) return;
  const price = costOf(upgrade, count);
  if (Math.round(sim.pol * 100) < Math.round(price * 100)) return;
  sim.pol = round3(sim.pol - price);
  sim.owned[id] = count + 1;
  save();
  publish();
}

export function pulseMine(): void {
  const now = Date.now();
  if (now < sim.pulseReadyAt) return;
  sim.pulseUntil = now + PULSE_MS;
  sim.pulseReadyAt = now + PULSE_MS + PULSE_COOLDOWN_MS;
  publish();
}

export function resetMine(): void {
  const next = freshSim();
  Object.assign(sim, next);
  sim.owned = emptyOwned();
  save();
  publish();
}
