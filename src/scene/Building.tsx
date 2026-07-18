import { useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { colorFor, type PlacedBuilding } from "../layout/cityLayout.ts";

interface BuildingProps {
  building: PlacedBuilding;
  selected: boolean;
  dimmed: boolean;
  /** Override color (blast-radius role / coverage tint) — overlays, not category. */
  tint?: string;
  showLabel: boolean;
  onSelect: (id: string) => void;
  onEnter: (id: string) => void;
}

export default function Building({ building, selected, dimmed, tint, showLabel, onSelect, onEnter }: BuildingProps) {
  const [hovered, setHovered] = useState(false);
  const color = tint ?? colorFor(building.category);
  const { x, z, width, depth, height, kind, enterable } = building;

  const emissiveIntensity = selected ? 0.95 : hovered ? 0.55 : 0.15;
  const opacity = dimmed && !selected ? 0.1 : 1;

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = enterable ? "zoom-in" : "pointer";
  };
  const out = () => {
    setHovered(false);
    document.body.style.cursor = "auto";
  };

  return (
    <group>
      <mesh
        position={[x, height / 2, z]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(building.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (enterable) onEnter(building.id);
        }}
        onPointerOver={over}
        onPointerOut={out}
      >
        {kind === "orchestrator" ? (
          <cylinderGeometry args={[width / 1.7, width / 1.7, height, 24]} />
        ) : (
          <boxGeometry args={[width, height, depth]} />
        )}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          transparent={opacity < 1}
          opacity={opacity}
          metalness={0.25}
          roughness={0.5}
        />
      </mesh>

      {/* "Enterable" base ring, brightened on focus. */}
      {enterable && !dimmed && (
        <mesh position={[x, 0.3, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[width * 0.75, width * 0.92, 32]} />
          <meshBasicMaterial color={color} transparent opacity={selected || hovered ? 0.9 : 0.35} />
        </mesh>
      )}

      {(showLabel || selected || hovered) && (
        <Html position={[x, height + 7, z]} center distanceFactor={360} pointerEvents="none" zIndexRange={[10, 0]}>
          <div
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              background: selected ? color : "rgba(15,23,42,0.82)",
              color: selected ? "#0b1220" : "#e2e8f0",
              border: `1px solid ${color}`,
              fontSize: 12,
              fontWeight: selected ? 700 : 500,
              whiteSpace: "nowrap",
              fontFamily: "system-ui, sans-serif",
              userSelect: "none",
            }}
          >
            {building.zone.label}
            {enterable && (selected || hovered) ? "  ⤵" : ""}
          </div>
        </Html>
      )}
    </group>
  );
}
