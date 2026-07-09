import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import Building from "./Building.tsx";
import Pipe from "./Pipe.tsx";
import type { CityLayout } from "../layout/cityLayout.ts";

interface CitySceneProps {
  layout: CityLayout;
  selectedId: string | null;
  matchedIds: Set<string> | null; // null = no active search (nothing dimmed)
  reducedMotion: boolean;
  onSelect: (id: string | null) => void;
}

export default function CityScene({ layout, selectedId, matchedIds, reducedMotion, onSelect }: CitySceneProps) {
  const span = Math.max(layout.bounds.width, layout.bounds.depth, 120);
  const dist = span * 0.8 + 140;
  const showAllLabels = layout.buildings.length <= 30;

  const buildings = useMemo(() => layout.buildings, [layout]);

  return (
    <Canvas
      camera={{ position: [dist * 0.6, dist * 0.7, dist * 0.6], fov: 45, near: 1, far: span * 8 + 2000 }}
      onPointerMissed={() => onSelect(null)}
      style={{ background: "linear-gradient(180deg, #0b1120 0%, #0f172a 60%, #111827 100%)" }}
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[span * 0.5 + 80, span + 200, span * 0.3 + 60]} intensity={1.15} />
      <hemisphereLight args={["#93c5fd", "#0b1120", 0.35]} />

      <Grid
        args={[span * 3, span * 3]}
        cellSize={20}
        cellThickness={0.6}
        cellColor="#1e293b"
        sectionSize={100}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={span * 2.5}
        fadeStrength={1.5}
        infiniteGrid
        position={[0, -0.01, 0]}
      />

      {layout.pipes.map((pipe) => (
        <Pipe
          key={pipe.id}
          pipe={pipe}
          active={selectedId != null && (pipe.from === selectedId || pipe.to === selectedId)}
          dimmed={matchedIds != null}
        />
      ))}

      {buildings.map((b) => (
        <Building
          key={b.id}
          building={b}
          selected={selectedId === b.id}
          dimmed={matchedIds != null && !matchedIds.has(b.id)}
          showLabel={showAllLabels && (matchedIds == null || matchedIds.has(b.id))}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        autoRotate={!reducedMotion && selectedId == null}
        autoRotateSpeed={0.4}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
