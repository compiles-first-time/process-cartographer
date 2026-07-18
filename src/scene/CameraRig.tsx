/**
 * CameraRig — lateral navigation for the city (user ask 2026-07-18: "no Z and X
 * movement; if a building is in the distance I can't navigate over to it").
 *
 * Two mechanisms, both translating camera + orbit-target together (a true pan):
 *  1. WASD / arrow keys — ground-plane movement relative to the camera heading;
 *     speed scales with zoom distance. Ignored while typing in inputs.
 *  2. Fly-to-selection: selecting a building glides the view over to it
 *     (instant when reduce-motion is on).
 * Right-drag panning (OrbitControls built-in) also works; the legend says so.
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface CameraRigProps {
  /** World position to glide to (selection focus), or null. */
  focus: [number, number, number] | null;
  /** Identity of the focus target — retrigger glide only when this changes. */
  focusKey: string | null;
  reducedMotion: boolean;
}

const KEYS: Record<string, [number, number]> = {
  // [forward, strafe-right] contributions
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
};

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}

export default function CameraRig({ focus, focusKey, reducedMotion }: CameraRigProps) {
  const pressed = useRef(new Set<string>());
  const glide = useRef<THREE.Vector3 | null>(null);
  const lastFocusKey = useRef<string | null>(null);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (KEYS[e.code]) {
        pressed.current.add(e.code);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => pressed.current.delete(e.code);
    const blur = () => pressed.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // New selection → start (or jump) the glide.
  useEffect(() => {
    if (focus && focusKey !== lastFocusKey.current) {
      lastFocusKey.current = focusKey;
      glide.current = new THREE.Vector3(focus[0], 0, focus[2]);
    }
    if (!focus) lastFocusKey.current = null;
  }, [focus, focusKey]);

  useFrame((_state, delta) => {
    if (!controls) return;
    let moved = false;

    // 1. Keyboard ground-plane movement (camera-heading relative).
    if (pressed.current.size > 0) {
      let fb = 0;
      let lr = 0;
      for (const code of pressed.current) {
        const k = KEYS[code];
        if (k) {
          fb += k[0];
          lr += k[1];
        }
      }
      if (fb !== 0 || lr !== 0) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        const right = new THREE.Vector3(forward.z, 0, -forward.x).negate(); // camera-right on ground
        const dist = camera.position.distanceTo(controls.target);
        const speed = Math.max(60, dist * 0.9); // world units/s, scales with zoom
        const dp = forward
          .multiplyScalar(fb)
          .add(right.multiplyScalar(lr))
          .normalize()
          .multiplyScalar(speed * delta);
        camera.position.add(dp);
        controls.target.add(dp);
        glide.current = null; // manual movement cancels the glide
        moved = true;
      }
    }

    // 2. Fly-to-selection glide.
    if (glide.current) {
      const dp = glide.current.clone().sub(new THREE.Vector3(controls.target.x, 0, controls.target.z));
      if (reducedMotion || dp.length() < 1) {
        camera.position.add(dp);
        controls.target.add(dp);
        glide.current = null;
      } else {
        const step = dp.multiplyScalar(Math.min(1, delta * 3.5));
        camera.position.add(step);
        controls.target.add(step);
      }
      moved = true;
    }

    if (moved) controls.update();
  });

  return null;
}
