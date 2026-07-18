/**
 * Minimap (A4) — a flat whole-city aerial for global orientation while
 * drill-down-as-LOD keeps the 3D scene small. Drawn on a 2D canvas (handles
 * thousands of rects without InstancedMesh); the district you are currently
 * inside is outlined, and clicking any block jumps the drill view there.
 */
import { useEffect, useRef, useState } from "react";
import { colorFor, type CityLayout } from "../layout/cityLayout.ts";

interface Props {
  /** Layout of the CITY ROOT level — the whole-city aerial. */
  rootLayout: CityLayout;
  /** Zone id of the top-level district currently drilled into (null at root). */
  currentTopId: string | null;
  onJump: (zoneId: string) => void;
}

const W = 208;
const H = 156;
const PAD = 8;

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function Minimap({ rootLayout, currentTopId, onJump }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rectsRef = useRef<Rect[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const bs = rootLayout.buildings;
    if (bs.length === 0) return;
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const b of bs) {
      minX = Math.min(minX, b.x - b.width / 2);
      maxX = Math.max(maxX, b.x + b.width / 2);
      minZ = Math.min(minZ, b.z - b.depth / 2);
      maxZ = Math.max(maxZ, b.z + b.depth / 2);
    }
    const scale = Math.min((W - PAD * 2) / Math.max(maxX - minX, 1), (H - PAD * 2) / Math.max(maxZ - minZ, 1));
    const ox = (W - (maxX - minX) * scale) / 2;
    const oy = (H - (maxZ - minZ) * scale) / 2;

    const rects: Rect[] = [];
    for (const b of bs) {
      const x = ox + (b.x - b.width / 2 - minX) * scale;
      const y = oy + (b.z - b.depth / 2 - minZ) * scale;
      const w = Math.max(b.width * scale, 2.5);
      const h = Math.max(b.depth * scale, 2.5);
      rects.push({ id: b.id, x, y, w, h });
      const isCurrent = b.id === currentTopId;
      ctx.fillStyle = colorFor(b.category);
      ctx.globalAlpha = isCurrent ? 1 : 0.75;
      ctx.fillRect(x, y, w, h);
      if (isCurrent) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      }
    }
    ctx.globalAlpha = 1;
    rectsRef.current = rects;
  }, [rootLayout, currentTopId, open]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const bounds = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const y = e.clientY - bounds.top;
    // Last drawn wins on overlap (matches paint order).
    for (let i = rectsRef.current.length - 1; i >= 0; i--) {
      const r = rectsRef.current[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        onJump(r.id);
        return;
      }
    }
  }

  return (
    <div className="minimap" aria-label="City minimap">
      <button className="minimap-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾ map" : "▸ map"}
      </button>
      {open && (
        <canvas
          ref={canvasRef}
          style={{ width: W, height: H }}
          onClick={handleClick}
          title="Whole-city aerial — your current district is outlined; click a block to jump there"
        />
      )}
    </div>
  );
}
