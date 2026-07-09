import { IR_SCHEMA_VERSION } from "./ir/schema.ts";

/**
 * M0 placeholder shell. The 3D "city map" renderer lands in M1 (it will consume
 * a validated IRGraph produced by the parser and, in the browser, an in-memory
 * ingest path that reuses `assembleIR`). For now this confirms the app boots and
 * the IR contract is wired in.
 */
export default function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720 }}>
      <h1>process-cartographer</h1>
      <p>
        A 3D city map of a UiPath REFramework automation. <strong>M0</strong> (parser → IR,
        tested) is in place; the interactive 3D map arrives in <strong>M1</strong>.
      </p>
      <p style={{ color: "#666" }}>IR schema contract: v{IR_SCHEMA_VERSION}</p>
    </main>
  );
}
