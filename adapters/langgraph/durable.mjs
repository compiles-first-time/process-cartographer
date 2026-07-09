// Durable, governed execution (ADR-0052, Option 4) on the LangGraph production host.
//
// A checkpointer-backed StateGraph: when the Loom guard returns "ask" for a
// destructive op, the graph calls the REAL LangGraph `interrupt()` — pausing and
// PERSISTING state to the checkpointer — then resumes via `Command({ resume })`
// with the human's decision. This is production-grade durability (state survives
// the pause; a crash could resume from the checkpoint) + human-in-the-loop, with
// the SAME Loom policy governing the decision. Needs @langchain/langgraph.

import { StateGraph, START, END, MemorySaver, interrupt, Command, Annotation } from "@langchain/langgraph";
import { preToolGuard } from "./guard.mjs";

const State = Annotation.Root({
  proposed: Annotation({ reducer: (_a, b) => b, default: () => null }),
  log: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

// Fake model: propose one destructive op (exercises the ask/interrupt path).
function agent() {
  return {
    proposed: {
      tool: "Bash",
      input: { command: "rm -rf build" },
      hits: [{ category: "destructive_actions", matched_on: "rm -rf", decision: "ask" }],
    },
  };
}

function guardNode(state) {
  const control = preToolGuard(state.proposed);
  if (control.action === "block") {
    return { log: [`[blocked] ${control.reason}`], proposed: null };
  }
  if (control.action === "interrupt") {
    // Durable HIL: pause + checkpoint; interrupt() returns the resume value.
    const decision = interrupt(control.payload);
    if (decision === "approve") {
      return { log: [`[approved] ${state.proposed.input.command}`, `[tools] EXECUTED`], proposed: null };
    }
    return { log: [`[rejected] skipped ${state.proposed.input.command}`], proposed: null };
  }
  return { log: [`[tools] EXECUTED ${state.proposed.input.command}`], proposed: null };
}

export function buildDurableGraph() {
  return new StateGraph(State)
    .addNode("agent", agent)
    .addNode("guard", guardNode)
    .addEdge(START, "agent")
    .addEdge("agent", "guard")
    .addEdge("guard", END)
    .compile({ checkpointer: new MemorySaver() });
}

// Returns { interrupted, resumedLog, executed } — proving pause→persist→resume.
export async function runDurableDemo(resumeWith = "approve") {
  const graph = buildDurableGraph();
  const cfg = { configurable: { thread_id: "loom-durable-demo" } };

  await graph.invoke({}, cfg);
  // The graph paused at the guard's interrupt(); state is persisted in the
  // checkpointer. Detect via getState().tasks[].interrupts (the durable pause).
  const paused = await graph.getState(cfg);
  const interrupts = (paused.tasks || []).flatMap((t) => t.interrupts || []);
  const interrupted = interrupts.length > 0;
  const interruptPayload = interrupted ? interrupts[0].value : null;

  // Resume with the human's decision — interrupt() returns `resumeWith`.
  const second = await graph.invoke(new Command({ resume: resumeWith }), cfg);
  const resumedLog = second.log || [];
  const executed = resumedLog.some((l) => l.includes("EXECUTED"));

  return { interrupted, resumedLog, executed, interruptPayload };
}
