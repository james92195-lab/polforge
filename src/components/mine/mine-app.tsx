import { useEffect, useLayoutEffect, useState, type ButtonHTMLAttributes } from "react";
import { Lattice } from "@/components/mine/lattice";
import {
  BASE_CAP,
  BASE_HASH,
  BASE_WATTS,
  UPGRADES,
  costOf,
  formatHash,
  formatPol,
  formatPrice,
  specLine,
  type Upgrade,
} from "@/lib/mine/model";
import { bootMine, buyUpgrade, pulseMine, resetMine, useMine } from "@/lib/mine/store";
import { getPolSpot } from "@/lib/mine/price";

function Action({
  variant,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant: "solid" | "line" | "ghost" }) {
  const look =
    variant === "solid"
      ? "bg-fg text-bg hover:opacity-90"
      : variant === "line"
        ? "border border-line bg-elevated text-fg hover:bg-subtle"
        : "text-muted hover:text-fg";
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-opacity duration-150 ease-out disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg ${look} ${className ?? ""}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Meter({ label, value, hot }: { label: string; value: number; hot: boolean }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className={`font-mono tabular-nums ${hot ? "text-warn" : "text-fg"}`}>
          {Math.round(clamped * 100)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-subtle">
        <div
          className={`meter-fill h-full origin-left ${hot ? "bg-warn" : "bg-fg"}`}
          style={{ transform: `scaleX(${clamped})` }}
        />
      </div>
    </div>
  );
}

function Spark({ points, current }: { points: number[]; current: number }) {
  const data = points.length >= 2 ? points : [current, current];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(0.001, max - min);
  const w = 320;
  const h = 64;
  const d = data
    .map((point, index) => {
      const x = (index / (data.length - 1)) * w;
      const y = h - 6 - ((point - min) / span) * (h - 12);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full text-fg" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount >= 1 ? 2 : 4,
    maximumFractionDigits: amount >= 1 ? 2 : 4,
  });
}

function usePolSpot(): number | null {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      getPolSpot()
        .then((next) => {
          if (active) setPrice(next);
        })
        .catch(() => {
          if (active) setPrice(null);
        });
    };
    load();
    const id = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);
  return price;
}

function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 2) return "now";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function UpgradeCard({ upgrade, owned, pol }: { upgrade: Upgrade; owned: number; pol: number }) {
  const maxed = owned >= upgrade.max;
  const price = costOf(upgrade, owned);
  const affordable = !maxed && Math.round(pol * 100) >= Math.round(price * 100);
  const shortfall = Math.max(0, Math.round((price - pol) * 100) / 100);
  return (
    <article className="rounded-xl border border-line bg-elevated p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium">{upgrade.name}</h3>
        <span className="font-mono text-sm tabular-nums text-muted">×{owned}</span>
      </div>
      <p className="mt-1 text-sm leading-normal text-muted">{upgrade.blurb}</p>
      <p className="mt-3 font-mono text-sm text-fg">{specLine(upgrade)}</p>
      <Action
        variant={affordable ? "solid" : "line"}
        className="mt-4 w-full"
        disabled={!affordable}
        onClick={() => buyUpgrade(upgrade.id)}
      >
        {maxed ? "Maxed" : affordable ? `Buy · ${formatPrice(price)} POL` : `Need ${formatPrice(shortfall)} more`}
      </Action>
    </article>
  );
}

export function MineApp() {
  const snap = useMine();
  const [confirm, setConfirm] = useState(false);
  const spot = usePolSpot();

  useLayoutEffect(() => bootMine(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "A")) {
        return;
      }
      event.preventDefault();
      pulseMine();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") setConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  const { derived } = snap;
  const load = derived.cap > 0 ? derived.watts / derived.cap : 1;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-fg" aria-hidden>
              <path
                d="M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3L12 2.6Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M12 8.1 16 10.4v4.6L12 17.3 8 15V10.4L12 8.1Z" fill="currentColor" />
            </svg>
            <h1 className="text-lg font-medium tracking-display">POLFORGE</h1>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-normal text-muted">
            Hashes pay play-credit POL. Blocks pay a bonus. Pulse spikes the rate for six seconds. Heat or an
            overloaded breaker cuts it.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-medium text-muted">
          Simulation
        </span>
      </header>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 gap-4 lg:col-span-2">
          <section className="rounded-xl border border-line bg-elevated p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted">Balance</p>
                <p className="text-display font-medium tracking-display tabular-nums leading-none">
                  {formatPol(snap.pol)}
                </p>
                <p className="mt-2 font-mono text-sm tabular-nums text-muted">
                  Play POL · +{formatPol(derived.polPerSec)} /s
                  {snap.earned > snap.pol + 0.05 ? ` · earned ${formatPol(snap.earned)}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {spot
                    ? `Live POL ${formatUsd(spot)}. This balance is not cash.`
                    : "Live price unavailable. This balance is not cash."}
                </p>
              </div>
              <Action
                variant="solid"
                className="relative w-full overflow-hidden sm:w-auto sm:min-w-40"
                disabled={snap.pulseMode !== "ready"}
                onClick={() => pulseMine()}
                aria-pressed={snap.pulseMode === "on"}
              >
                <span>
                  {snap.pulseMode === "on"
                    ? "Pulsing"
                    : snap.pulseMode === "cool"
                      ? `Cooling ${snap.pulseSeconds}s`
                      : "Pulse"}
                </span>
                {snap.pulseMode === "ready" ? (
                  <kbd className="hidden font-mono text-xs text-bg/70 sm:inline">Space</kbd>
                ) : null}
                {snap.pulseMode !== "ready" ? (
                  <span
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-bg/40"
                    style={{ transform: `scaleX(${snap.pulseRatio})` }}
                  />
                ) : null}
              </Action>
            </div>
          </section>

          <section className="h-44 overflow-hidden rounded-xl border border-line bg-elevated sm:h-56" aria-hidden>
            <Lattice />
          </section>

          <section className="rounded-xl border border-line bg-elevated p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Hash" value={formatHash(derived.effective)} />
              <Stat label="Heat" value={`${Math.round(snap.heat)}°`} hot={derived.overHeat} />
              <Stat
                label="Draw"
                value={`${Math.round(derived.watts)} / ${Math.round(derived.cap)} W`}
                hot={derived.overPower}
              />
              <Stat label="Blocks" value={String(snap.blocks)} />
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Meter label="Load" value={load} hot={derived.overPower} />
              <Meter label="Heat" value={snap.heat / 100} hot={derived.overHeat} />
            </div>
            {snap.note ? (
              <p className="mt-4 text-sm text-warn" role="status">
                {snap.note}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-line bg-elevated p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium text-muted">Effective hash</h2>
              <p className="font-mono text-sm tabular-nums text-fg">
                about every {Math.max(1, Math.round(snap.mean))}s
              </p>
            </div>
            <div className="mt-3">
              <Spark points={snap.samples} current={derived.effective} />
            </div>
          </section>

          <section className="rounded-xl border border-line bg-elevated p-4">
            <h2 className="text-sm font-medium text-muted">Blocks</h2>
            {snap.log.length === 0 ? (
              <p className="mt-3 text-sm leading-normal text-muted">No blocks yet. The floor is hashing.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {snap.log.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3 font-mono text-sm tabular-nums">
                    <span className="text-muted">#{item.id}</span>
                    <span className="text-fg">+{formatPol(item.reward)} POL</span>
                    <span className="text-muted">{ago(item.at, snap.now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="grid min-w-0 gap-3 lg:sticky lg:top-4">
          <h2 className="text-sm font-medium text-muted">Stack</h2>
          <article className="rounded-xl border border-line bg-elevated p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-medium">Starter card</h3>
              <span className="font-mono text-sm text-muted">included</span>
            </div>
            <p className="mt-1 text-sm leading-normal text-muted">The floor boots on one card.</p>
            <p className="mt-3 font-mono text-sm text-fg">
              {BASE_HASH} MH/s · {BASE_WATTS} W · {BASE_CAP} W cap
            </p>
          </article>
          {UPGRADES.map((upgrade) => (
            <UpgradeCard
              key={upgrade.id}
              upgrade={upgrade}
              owned={snap.owned[upgrade.id]}
              pol={snap.pol}
            />
          ))}
          <Action variant="ghost" className="justify-self-start px-0" onClick={() => setConfirm(true)}>
            Reset floor
          </Action>
        </aside>
      </div>

      <footer className="mt-8 max-w-xl text-sm leading-normal text-muted">
        Play credits only. The figure above is Coinbase's live POL price, not a balance you can withdraw. Polygon is
        proof-of-stake, so a browser cannot mine it for real money.
      </footer>

      {confirm ? (
        <div
          className="fixed inset-0 z-20 flex items-end justify-center bg-bg/80 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-line bg-elevated p-5">
            <h2 id="reset-title" className="text-lg font-medium">
              Reset the floor?
            </h2>
            <p className="mt-2 text-sm leading-normal text-muted">
              Balance, rigs, and blocks go back to the starter card. This stays on this device.
            </p>
            <div className="mt-5 flex gap-2">
              <Action variant="line" className="flex-1" onClick={() => setConfirm(false)}>
                Keep
              </Action>
              <Action
                variant="solid"
                className="flex-1"
                autoFocus
                onClick={() => {
                  resetMine();
                  setConfirm(false);
                }}
              >
                Reset
              </Action>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Stat({ label, value, hot = false }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 truncate font-mono text-base tabular-nums ${hot ? "text-warn" : "text-fg"}`}>{value}</p>
    </div>
  );
}
