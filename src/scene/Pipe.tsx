import { QuadraticBezierLine } from "@react-three/drei";
import type { PlacedPipe } from "../layout/cityLayout.ts";

interface PipeProps {
  pipe: PlacedPipe;
  active: boolean; // connected to the selected building
  dimmed: boolean;
}

export default function Pipe({ pipe, active, dimmed }: PipeProps) {
  const [fx, fy, fz] = pipe.fromPos;
  const [tx, ty, tz] = pipe.toPos;
  // Arc the pipe above the taller endpoint so it reads as a transit line.
  const mid: [number, number, number] = [(fx + tx) / 2, Math.max(fy, ty) + 18, (fz + tz) / 2];

  const isRef = pipe.kind === "reference";
  // Reference pipes (doc/config mentions): amber + dashed — visibly NOT an import.
  const color = active ? (isRef ? "#fbbf24" : "#38bdf8") : isRef ? "#8a7340" : "#64748b";
  const opacity = dimmed && !active ? 0.06 : active ? 0.95 : isRef ? 0.3 : 0.35;
  const lineWidth = active ? 2.5 : isRef ? 1 : 1.2;

  return (
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
  );
}
