// LangGraph adapter — binds the Loom spec to a LangGraph.js graph (ADR-0050).
//
// The SECOND adapter (ADR-0048 OB-P2). It reuses the portable spec evaluator
// (ADR-0049: one JS evaluator serves all JS hosts) — so it never re-decides
// policy. Its job is the HOST-SPECIFIC part: mapping a Loom decision to
// LangGraph's control primitives. Passing spec/conformance with THIS adapter's
// decide fn (alongside the Claude Code adapter's) is what makes "model-agnostic"
// a fact rather than a claim.
//
// Enforcement mapping (per LangGraph HIL/interrupt docs):
//   deny  -> block   : a conditional edge routes away from the ToolNode; tool NOT run
//   ask   -> interrupt: the node calls interrupt(payload) to pause for approval;
//                       resumed via Command({ resume }) (proceed) or aborted
//   allow -> proceed : execute the tool (contained scope — trusted, Rule 8)
//   none  -> proceed : execute the tool (no policy signal)
//
// Dependency-free: importing this module does NOT require @langchain/langgraph.
// The live wiring (buildGuardedToolFlow) is illustrated in README + example.run.mjs.

import { decideDestructiveAction } from "../../scripts/lib/destructive-guard.mjs";

// Conformance decide fn: the SAME spec evaluator, invoked at LangGraph's seam.
export function decide(scenario) {
  return decideDestructiveAction({
    tool: scenario.tool,
    input: scenario.input,
    hits: scenario.hits || [],
  }).decision;
}

// Map a Loom decision result to LangGraph control semantics.
export function toLangGraphControl(result) {
  const decision = (result && result.decision) || "none";
  const reason = (result && result.reason) || "";
  switch (decision) {
    case "deny":
      // Hard block: the graph must route away from tool execution.
      return { action: "block", proceed: false, interrupt: false, reason };
    case "ask":
      // Human-in-the-loop: pause via interrupt() and await approval.
      return {
        action: "interrupt",
        proceed: false,
        interrupt: true,
        reason,
        payload: { type: "approval_required", reason },
      };
    case "allow":
    case "none":
    default:
      return { action: "proceed", proceed: true, interrupt: false, reason };
  }
}

// Ready-to-wire pre-tool guard for a LangGraph node. Given a tool call, returns
// the control decision the graph should act on:
//   action "block"     -> conditional edge to an END/blocked node (skip ToolNode)
//   action "interrupt" -> node calls interrupt(control.payload)
//   action "proceed"   -> continue to the ToolNode
export function preToolGuard({ tool, input, hits } = {}) {
  const result = decideDestructiveAction({ tool, input, hits: hits || [] });
  return {
    ...toLangGraphControl(result),
    decision: result.decision,
    tier: result.tier,
    matched_on: result.matched_on,
  };
}
