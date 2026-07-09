import { useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { CATEGORY_COLORS, type PlacedBuilding } from "../layout/cityLayout.ts";

interface BuildingProps {
  building: PlacedBuilding;
  selected: boolean;
  dimmed: boolean;
  showLabel: boolean;
  onSelect: (id: string) => void;
}

export default function Building({ building, selected, dimmed, showLabel, onSelect }: BuildingProps) {
  const [hovered, setHovered] = useState(false);
  const color = CATEGORY_COLORS[building.category];
  const { x, z, width, depth, height } = building;

  const emissiveIntensity = selected ? 0.9 : hovered ? 0.5 : 0.12;
  const opacity = dimmed && !selected ? 0.12 : 1;

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = "pointer";
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
        onPointerOver={over}
        onPointerOut={out}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          transparent={opacity < 1}
          opacity={opacity}
          metalness={0.2}
          roughness={0.55}
        />
      </mesh>

      {/* Dangling / dynamic invoke beacon (RISK-01: surfaced, not hidden). */}
      {building.danglingInvokes > 0 && !dimmed && (
        <mesh position={[x, height + 10, z]}>
          <coneGeometry args={[3, 12, 8]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8} />
        </mesh>
      )}

      {(showLabel || selected || hovered) && (
        <Html position={[x, height + 6, z]} center distanceFactor={340} pointerEvents="none" zIndexRange={[10, 0]}>
          <div
            style={{
              padding: "2px 7px",
              borderRadius: 5,
              background: selected ? "rgba(56,189,248,0.95)" : "rgba(15,23,42,0.8)",
              color: selected ? "#0b1220" : "#e2e8f0",
              border: `1px solid ${color}`,
              fontSize: 12,
              fontWeight: selected ? 700 : 500,
              whiteSpace: "nowrap",
              fontFamily: "system-ui, sans-serif",
              userSelect: "none",
            }}
          >
            {building.workflow.displayName || building.id}
          </div>
        </Html>
      )}
    </group>
  );
}
