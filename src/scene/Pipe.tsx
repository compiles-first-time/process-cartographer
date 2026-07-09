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

  const color = active ? "#38bdf8" : "#64748b";
  const opacity = dimmed && !active ? 0.06 : active ? 0.95 : 0.35;
  const lineWidth = active ? 2.5 : 1.2;

  return (
    <QuadraticBezierLine
      start={pipe.fromPos}
      end={pipe.toPos}
      mid={mid}
      color={color}
      lineWidth={lineWidth}
      transparent
      opacity={opacity}
    />
  );
}
