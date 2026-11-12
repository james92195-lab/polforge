import { useEffect, useRef } from "react";
import { stage } from "@/lib/mine/store";

type Hex = { x: number; y: number };

function paintHex(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function Lattice() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let running = true;
    let raf = 0;
    let width = 0;
    let height = 0;
    let radius = 14;
    const hexes: Hex[] = [];
    const sparks: { index: number; life: number }[] = [];
    let lastShare = stage.shareSerial;
    let lastBlock = stage.blockSerial;
    let wave = 0;
    let prev = performance.now();

    const fg = cssColor("--color-fg", "#f3f3f4");
    const accent = cssColor("--color-accent", "#8b6cff");

    function layout(): void {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (w === width && h === height && hexes.length) return;
      width = w;
      height = h;
      canvas!.width = w;
      canvas!.height = h;
      radius = 13 * dpr;
      const dx = Math.sqrt(3) * radius;
      const dy = 1.5 * radius;
      hexes.length = 0;
      const cols = Math.ceil(w / dx) + 1;
      const rows = Math.ceil(h / dy) + 1;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * dx + (row % 2 ? dx / 2 : 0) - dx * 0.2;
          const y = row * dy + radius * 0.35;
          hexes.push({ x, y });
        }
      }
    }

    function frame(now: number): void {
      if (!running) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      layout();
      const count = hexes.length;
      ctx!.clearRect(0, 0, width, height);
      if (!count) {
        raf = requestAnimationFrame(frame);
        return;
      }

      ctx!.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.9);
      ctx!.strokeStyle = fg;
      ctx!.globalAlpha = 0.16;
      for (const hex of hexes) {
        paintHex(ctx!, hex.x, hex.y, radius * 0.82);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      if (stage.shareSerial !== lastShare) {
        const burst = Math.min(3, stage.shareSerial - lastShare);
        lastShare = stage.shareSerial;
        for (let i = 0; i < burst; i++) {
          sparks.push({ index: Math.floor(Math.random() * count), life: 1 });
        }
      }
      if (stage.blockSerial !== lastBlock) {
        lastBlock = stage.blockSerial;
        wave = 1;
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i]!;
        spark.life -= dt * (reduce ? 2.4 : 0.85);
        if (spark.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        const hex = hexes[spark.index];
        if (!hex) continue;
        paintHex(ctx!, hex.x, hex.y, radius * 0.82);
        ctx!.fillStyle = accent;
        ctx!.globalAlpha = spark.life * 0.45;
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      if (wave > 0) {
        const reach = (1 - wave) * Math.hypot(width, height) * 0.55;
        const band = 36 * Math.max(1, window.devicePixelRatio || 1);
        const cx = width / 2;
        const cy = height / 2;
        ctx!.strokeStyle = accent;
        ctx!.lineWidth = Math.max(1.25, (window.devicePixelRatio || 1));
        for (const hex of hexes) {
          const dist = Math.hypot(hex.x - cx, hex.y - cy);
          const delta = Math.abs(dist - reach);
          if (delta > band) continue;
          paintHex(ctx!, hex.x, hex.y, radius * 0.82);
          ctx!.globalAlpha = (1 - delta / band) * wave * 0.85;
          ctx!.stroke();
        }
        ctx!.globalAlpha = 1;
        wave -= dt * (reduce ? 2.2 : 0.85);
      }

      const speed = reduce ? 0 : 0.45 + stage.intensity * 2.2;
      const head = Math.floor((now / 1000) * speed) % count;
      const trail = 6;
      for (let step = trail; step >= 0; step--) {
        const hex = hexes[(head - step + count) % count];
        if (!hex) continue;
        paintHex(ctx!, hex.x, hex.y, radius * 0.82);
        const lead = step === 0;
        ctx!.globalAlpha = lead ? 0.95 : 0.14 + (1 - step / trail) * 0.4;
        ctx!.strokeStyle = fg;
        ctx!.lineWidth = lead ? Math.max(1.5, (window.devicePixelRatio || 1) * 1.15) : Math.max(1, window.devicePixelRatio || 1);
        if (lead) {
          ctx!.fillStyle = accent;
          ctx!.globalAlpha = 0.28;
          ctx!.fill();
          ctx!.globalAlpha = 0.95;
        }
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    const observer = new ResizeObserver(() => layout());
    observer.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="block h-full w-full" aria-hidden />;
}
