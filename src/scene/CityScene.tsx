import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import Building from "./Building.tsx";
import Pipe from "./Pipe.tsx";
import CameraRig from "./CameraRig.tsx";
import type { CityLayout } from "../layout/cityLayout.ts";

interface CitySceneProps {
  layout: CityLayout;
  selectedId: string | null;
  matchedIds: Set<string> | null;
  /** Blast-radius roles at this level (A1) — non-members dim while active. */
  radiusByZone?: Map<string, "self" | "up" | "down" | "both"> | null;
  /** A3 path roles at this level — the lit corridor; non-members dim while active. */
  pathByZone?: Map<string, "endpoint" | "hop"> | null;
  /** Coverage fraction 0..1 per zone (E1) — tints buildings red→green. */
  coverageByZone?: Map<string, number> | null;
  reducedMotion: boolean;
  onSelect: (id: string | null) => void;
  onEnter: (id: string) => void;
}

const ROLE_TINT: Record<string, string> = {
  self: "#38bdf8", // the selected building
  up: "#f59e0b", // depends on it (would feel a change)
  down: "#60a5fa", // it depends on these
  both: "#c084fc",
};

const PATH_TINT: Record<string, string> = {
  endpoint: "#34d399", // A and B
  hop: "#fbbf24", // the corridor between them
};

/** red (0) → yellow → green (1), readable on the dark theme. */
function coverageTint(v: number): string {
  return "hsl(" + Math.round(v * 120) + ", 65%, 46%)";
}

export default function CityScene({ layout, selectedId, matchedIds, radiusByZone, pathByZone, coverageByZone, reducedMotion, onSelect, onEnter }: CitySceneProps) {
  const selected = selectedId ? layout.buildings.find((b) => b.id === selectedId) ?? null : null;
  const span = Math.max(layout.bounds.width, layout.bounds.depth, 140);
  const dist = span * 0.85 + 150;
  const showAllLabels = layout.buildings.length <= 28;
  const groundSize = span * 4;

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ position: [dist * 0.55, dist * 0.7, dist * 0.75], fov: 45, near: 1, far: span * 10 + 3000 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#0b1120"]} />
      <fog attach="fog" args={["#0b1120", dist * 0.8, dist * 3.5]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[span * 0.5 + 100, span + 240, span * 0.35 + 80]} intensity={1.15} />
      <hemisphereLight args={["#93c5fd", "#0b1120", 0.4]} />

      {/* Solid ground BELOW the grid removes the shimmer/z-fighting the infinite grid caused. */}
      <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial color="#0d1526" metalness={0} roughness={1} />
      </mesh>
      <Grid
        args={[groundSize, groundSize]}
        cellSize={24}
        cellThickness={0.5}
        cellColor="#1b2740"
        sectionSize={120}
        sectionThickness={1}
        sectionColor="#2b3b5c"
        fadeDistance={dist * 2.2}
        fadeStrength={2}
        followCamera={false}
        position={[0, 0, 0]}
      />

      {layout.pipes.map((pipe) => (
        <Pipe
          key={pipe.id}
          pipe={pipe}
          active={
            (selectedId != null && (pipe.from === selectedId || pipe.to === selectedId)) ||
            (pathByZone != null && pathByZone.has(pipe.from) && pathByZone.has(pipe.to))
          }
          dimmed={matchedIds != null || (pathByZone != null && !(pathByZone.has(pipe.from) && pathByZone.has(pipe.to)))}
        />
      ))}

      {layout.buildings.map((b) => {
        const role = radiusByZone?.get(b.id) ?? null;
        const pathRole = pathByZone?.get(b.id) ?? null;
        const cov = coverageByZone?.get(b.id);
        const tint = pathRole ? PATH_TINT[pathRole] : role ? ROLE_TINT[role] : cov != null ? coverageTint(cov) : undefined;
        const dimmed =
          (matchedIds != null && !matchedIds.has(b.id)) ||
          (radiusByZone != null && role == null) ||
          (pathByZone != null && pathRole == null);
        return (
          <Building
            key={b.id}
            building={b}
            selected={selectedId === b.id}
            dimmed={dimmed}
            tint={tint}
            showLabel={showAllLabels && (matchedIds == null || matchedIds.has(b.id))}
            onSelect={onSelect}
            onEnter={onEnter}
          />
        );
      })}

      <CameraRig
        focus={selected ? [selected.x, 0, selected.z] : null}
        focusKey={selected ? selected.id : null}
        reducedMotion={reducedMotion}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        autoRotate={!reducedMotion && selectedId == null}
        autoRotateSpeed={0.35}
        minDistance={40}
        maxDistance={span * 6 + 800}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
