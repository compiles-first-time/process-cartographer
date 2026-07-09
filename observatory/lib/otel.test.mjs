#!/usr/bin/env node
// Unit tests for observatory/lib/otel.mjs — the OTLP mapper (ADR-0051).

import { toOtelLogRecord, toOtlpLogs, toUnixNano, toAnyValue, severityFor } from "./otel.mjs";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

console.log("\ntoUnixNano — BigInt-precise");
{
  // 2026-07-06T00:00:00.000Z = 1783296000000 ms → *1e6 ns (exact, no float loss)
  const ns = toUnixNano("2026-07-06T00:00:00.000Z");
  assert(ns === (BigInt(Date.parse("2026-07-06T00:00:00.000Z")) * 1000000n).toString(), "nanos are exact BigInt string");
  assert(!ns.includes("e") && !ns.includes("."), "nanos have no float artifacts");
  assert(toUnixNano("not-a-date") === "0", "invalid timestamp → 0");
}

console.log("\ntoAnyValue — OTLP typing");
{
  assert(toAnyValue("x").stringValue === "x", "string → stringValue");
  assert(toAnyValue(true).boolValue === true, "bool → boolValue");
  assert(toAnyValue(7).intValue === "7", "integer → intValue (string int64)");
  assert(toAnyValue(1.5).doubleValue === 1.5, "float → doubleValue");
  assert(toAnyValue(null).stringValue === "", "null → empty stringValue");
  assert(JSON.parse(toAnyValue({ a: 1 }).stringValue).a === 1, "object → JSON stringValue");
}

console.log("\nseverityFor — bands");
{
  assert(severityFor({ event_type: "tool_call" })[1] === "INFO", "tool_call → INFO");
  assert(severityFor({ event_type: "tool_result", exit_code: 1 })[1] === "ERROR", "failed tool_result → ERROR");
  assert(severityFor({ event_type: "deployment_failed" })[1] === "ERROR", "…failed → ERROR");
  assert(severityFor({ event_type: "destructive_action_decision", decision: "deny" })[1] === "WARN", "deny → WARN");
  assert(severityFor({ event_type: "constitution_check_missing" })[1] === "WARN", "…missing → WARN");
}

console.log("\ntoOtelLogRecord");
{
  const rec = toOtelLogRecord({
    timestamp: "2026-07-06T12:00:00.000Z", event_type: "tool_call",
    kernel_version: "v6", loom_version: "0.2.0", session_id: "s1", tool: "Bash", exit_code: 0,
  });
  assert(rec.body.stringValue === "tool_call", "body = event_type");
  assert(rec.severityText === "INFO", "severity mapped");
  assert(rec.timeUnixNano === rec.observedTimeUnixNano, "time + observedTime set");
  const keys = rec.attributes.map((a) => a.key);
  assert(keys.includes("session_id") && keys.includes("tool"), "payload fields become attributes");
  assert(!keys.includes("timestamp") && !keys.includes("kernel_version"), "envelope keys skipped");
  const sid = rec.attributes.find((a) => a.key === "session_id");
  assert(sid.value.stringValue === "s1", "attribute value typed");
}

console.log("\ntoOtlpLogs — envelope");
{
  const payload = toOtlpLogs([{ timestamp: "2026-07-06T12:00:00.000Z", event_type: "tool_call" }], { version: "9.9.9" });
  assert(Array.isArray(payload.resourceLogs), "resourceLogs is an array");
  const res = payload.resourceLogs[0].resource.attributes.find((a) => a.key === "service.name");
  assert(res.value.stringValue === "loom", "resource service.name = loom");
  assert(payload.resourceLogs[0].scopeLogs[0].scope.version === "9.9.9", "scope version passthrough");
  assert(payload.resourceLogs[0].scopeLogs[0].logRecords.length === 1, "one logRecord per event");
  assert(toOtlpLogs([]).resourceLogs[0].scopeLogs[0].logRecords.length === 0, "empty events → empty logRecords");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
