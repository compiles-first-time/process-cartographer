import { useMemo, useState } from "react";
import { QuadraticBezierLine, Html } from "@react-three/drei";
import { QuadraticBezierCurve3, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { PlacedPipe } from "../layout/cityLayout.ts";

interface PipeProps {
  pipe: PlacedPipe;
  active: boolean; // connected to the selected building / on the lit path
  dimmed: boolean;
  /** A5 tooltip: display labels for the pipe's endpoint zones. */
  fromLabel?: string;
  toLabel?: string;
  /** A5 click-to-open: select the pipe's source zone (its panel lists the edges). */
  onPick?: (zoneId: string) => void;
}

export default function Pipe({ pipe, active, dimmed, fromLabel, toLabel, onPick }: PipeProps) {
  const [hovered, setHovered] = useState(false);
  const [fx, fy, fz] = pipe.fromPos;
  const [tx, ty, tz] = pipe.toPos;
  // Arc the pipe above the taller endpoint so it reads as a transit line.
  const mid: [number, number, number] = [(fx + tx) / 2, Math.max(fy, ty) + 18, (fz + tz) / 2];

  const isRef = pipe.kind === "reference";
  const lit = active || hovered;
  // Reference pipes (doc/config mentions): amber + dashed — visibly NOT an import.
  const color = lit ? (isRef ? "#fbbf24" : "#38bdf8") : isRef ? "#8a7340" : "#64748b";
  const opacity = dimmed && !lit ? 0.06 : lit ? 0.95 : isRef ? 0.3 : 0.35;
  const lineWidth = lit ? 2.5 : isRef ? 1 : 1.2;

  // A5: an invisible picking tube along the same curve — fat-line raycasting is
  // unreliable, a tube is not. Only when the pipe is interrogable (has sources).
  const pickGeom = useMemo(() => {
    if (!pipe.sources?.length) return null;
    const curve = new QuadraticBezierCurve3(new Vector3(fx, fy, fz), new Vector3(...mid), new Vector3(tx, ty, tz));
    return curve;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, fy, fz, tx, ty, tz, pipe.sources]);

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = onPick ? "pointer" : "default";
  };
  const out = () => {
    setHovered(false);
    document.body.style.cursor = "auto";
  };

  const total = pipe.total ?? pipe.sources?.length ?? 0;
  const shown = pipe.sources ?? [];

  return (
    <group>
      <QuadraticBezierLine
        start={pipe.fromPos}
        end={pipe.toPos}
        mid={mid}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={opacity}
        dashed={isRef}
        dashSize={6}
        gapSize={4}
      />
      {pickGeom && (
        <mesh
          onPointerOver={over}
          onPointerOut={out}
          onClick={(e) => {
            e.stopPropagation();
            onPick?.(pipe.from);
          }}
          visible={false}
        >
          <tubeGeometry args={[pickGeom, 20, 4, 6, false]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {hovered && shown.length > 0 && (
        <Html position={mid} center distanceFactor={420} pointerEvents="none" zIndexRange={[30, 20]}>
          <div className="pipe-tip">
            <div className="pipe-tip-head">
              {fromLabel ?? pipe.from} → {toLabel ?? pipe.to}
            </div>
            <div className="pipe-tip-kind">
              {isRef ? "reference — doc/config mention (resolved-heuristic)" : "import — resolved-static"} · {total} file edge{total === 1 ? "" : "s"}
            </div>
            {shown.slice(0, 3).map((s, i) => (
              <div className="pipe-tip-src" key={i}>
                {s.from}
                {s.line != null ? `:${s.line}` : ""} → {s.to}
              </div>
            ))}
            {total > 3 && <div className="pipe-tip-src">… {total - 3} more</div>}
            {onPick && <div className="pipe-tip-hint">click to open the source panel</div>}
          </div>
        </Html>
      )}
    </group>
  );
}
