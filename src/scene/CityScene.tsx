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
  reducedMotion: boolean;
  onSelect: (id: string | null) => void;
  onEnter: (id: string) => void;
}

export default function CityScene({ layout, selectedId, matchedIds, reducedMotion, onSelect, onEnter }: CitySceneProps) {
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
          active={selectedId != null && (pipe.from === selectedId || pipe.to === selectedId)}
          dimmed={matchedIds != null}
        />
      ))}

      {layout.buildings.map((b) => (
        <Building
          key={b.id}
          building={b}
          selected={selectedId === b.id}
          dimmed={matchedIds != null && !matchedIds.has(b.id)}
          showLabel={showAllLabels && (matchedIds == null || matchedIds.has(b.id))}
          onSelect={onSelect}
          onEnter={onEnter}
        />
      ))}

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
