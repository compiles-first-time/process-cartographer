// LIVE demo (ADR-0052): durable, governed execution on LangGraph.
// Run: cd adapters/langgraph && npm install && node durable.run.mjs
import { runDurableDemo } from "./durable.mjs";

const r = await runDurableDemo("approve");
console.log("\n=== Durable governed execution (LangGraph checkpointer + real interrupt/resume) ===");
console.log("run 1 — guard hit 'ask' on a destructive op →",
  r.interrupted ? "INTERRUPTED (state persisted to checkpointer)" : "did NOT interrupt (?)");
console.log("resume — Command({resume:'approve'}) →");
for (const line of r.resumedLog) console.log("   " + line);
console.log("\nexecuted after approval:", r.executed, "· same Loom policy, now durable + resumable. ✓");
