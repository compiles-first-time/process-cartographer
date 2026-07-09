// LIVE demo (ADR-0050): a real LangGraph StateGraph governed by Loom's policy.
//
// A FAKE model (no API key) proposes a scripted sequence of tool calls; the
// `guard` node runs Loom's preToolGuard at the pre-tool seam and routes:
//   proceed -> tools (execute) · deny -> blocked · ask -> approval (interrupt point)
//
// Run:  cd adapters/langgraph && npm install && node example.run.mjs
// Not part of the always-green suite (needs @langchain/langgraph).

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { preToolGuard } from "./guard.mjs";

function dhit(m) { return [{ category: "destructive_actions", matched_on: m, decision: "ask" }]; }

// What a model would emit — a scripted tool-call sequence exercising all tiers.
const SCRIPT = [
  { tool: "Bash", input: { command: "npm test" } },                                    // proceed
  { tool: "Bash", input: { command: "rm -rf build" }, hits: dhit("rm -rf") },           // ask -> approval
  { tool: "Bash", input: { command: "git push --force origin main" } },                 // deny -> blocked
  { tool: "Bash", input: { command: "rm -rf .worktrees/tmp" }, hits: dhit("rm -rf") },  // allow (contained) -> proceed
];

const State = Annotation.Root({
  step: Annotation({ reducer: (_a, b) => b, default: () => 0 }),
  proposed: Annotation({ reducer: (_a, b) => b, default: () => null }),
  control: Annotation({ reducer: (_a, b) => b, default: () => null }),
  log: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

const agent = (s) => ({ proposed: SCRIPT[s.step] || null });

const guard = (s) => {
  if (!s.proposed) return {};
  const control = preToolGuard(s.proposed);
  return { control, log: [`[guard] "${s.proposed.input.command}" → ${control.action}`] };
};

const tools = (s) => ({ log: [`  [tools] EXECUTED: ${s.proposed.input.command}`], step: s.step + 1, proposed: null, control: null });
const approval = (s) => ({ log: [`  [interrupt] PAUSED for human approval — ${s.control?.reason?.slice(0, 60)}`], step: s.step + 1, proposed: null, control: null });
const blocked = (s) => ({ log: [`  [blocked] DENIED — ${s.control?.reason?.slice(0, 60)}`], step: s.step + 1, proposed: null, control: null });

const afterGuard = (s) => {
  const a = s.control?.action;
  if (a === "proceed") return "tools";
  if (a === "interrupt") return "approval"; // production: node calls interrupt(control.payload)
  return "blocked";
};
const loop = (s) => (s.step < SCRIPT.length ? "agent" : END);

const graph = new StateGraph(State)
  .addNode("agent", agent)
  .addNode("guard", guard)
  .addNode("tools", tools)
  .addNode("approval", approval)
  .addNode("blocked", blocked)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", (s) => (s.proposed ? "guard" : END), { guard: "guard", [END]: END })
  .addConditionalEdges("guard", afterGuard, { tools: "tools", approval: "approval", blocked: "blocked" })
  .addConditionalEdges("tools", loop, { agent: "agent", [END]: END })
  .addConditionalEdges("approval", loop, { agent: "agent", [END]: END })
  .addConditionalEdges("blocked", loop, { agent: "agent", [END]: END })
  .compile();

const result = await graph.invoke({});
console.log("\n=== A LangGraph graph governed by the Loom spec (fake model) ===");
for (const line of result.log) console.log(line);
console.log("\nSame policy as the Claude Code adapter, enforced at LangGraph's seam — host-agnostic. ✓");
