/**
 * xamlParser — parse ONE UiPath `.xaml` (Windows Workflow Foundation XML) into
 * a WorkflowNode plus its raw invoke edges. Pure (no filesystem) so it is
 * trivially testable (M0 provable base).
 *
 * Design grounded in the real vanilla REFramework vendored at
 * `fixtures/reframework/` (see the uipath-xaml specialist SKILL.md for the
 * domain rationale). Key facts this relies on:
 *   - XAML is XML with namespaces: `ui:` = UiPath activities, `sap`/`sap2010`
 *     = design-time (noise), `x:` = XAML language.
 *   - `InvokeWorkflowFile` (@WorkflowFileName) is REFramework's modular spine.
 *   - Workflow arguments are `x:Property` under the root `x:Members`.
 *   - `StateMachine`/`State` model Main's transaction lifecycle.
 *   - A `WorkflowFileName` beginning with `[` is a VB expression → the invoke
 *     target is only known at runtime (RISK-01 / a real REFramework edge case).
 */
import { XMLParser } from "fast-xml-parser";
import type { Argument, ArgumentDirection, Target, WorkflowKind } from "../ir/schema.ts";

/** A raw invoke reference; the orchestrator resolves `to`/`resolved` against the file set. */
export interface RawInvoke {
  raw: string;
}

/** A state as parsed — invokes are still RAW filenames (assembleIR resolves them to ids). */
export interface ParsedState {
  name: string;
  displayName?: string;
  isFinal: boolean;
  activityCount: number;
  rawInvokes: string[];
}

export interface ParsedWorkflow {
  displayName?: string;
  kind: WorkflowKind;
  arguments: Argument[];
  states: ParsedState[];
  activityCounts: Record<string, number>;
  targets: Target[];
  rawInvokes: RawInvoke[];
  /** Count of non-plumbing activity element occurrences. */
  activityCount: number;
  warnings: string[];
}

const ATTR_PREFIX = "@_";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  removeNSPrefix: false, // keep `ui:`, `x:` etc.; we strip to localName ourselves
  parseAttributeValue: false, // selectors/expressions must stay verbatim strings
  parseTagValue: false,
  trimValues: true,
});

/** Element local names that are XAML/WF plumbing, not user-facing activities. */
const PLUMBING = new Set([
  "Members",
  "Property",
  "Variable",
  "Variables",
  "Collection",
  "String",
  "Boolean",
  "Int32",
  "Double",
  "DateTime",
  "Object",
  "Null",
  "Reference",
  "AssemblyReference",
  "TypeArguments",
  "ActivityAction",
  "DelegateInArgument",
  "DelegateOutArgument",
]);

function isPlumbing(localName: string): boolean {
  if (localName.includes(".")) return true; // property element, e.g. Sequence.Variables
  if (/ViewState/i.test(localName)) return true;
  if (localName.startsWith("?")) return true;
  return PLUMBING.has(localName);
}

function localNameOf(tag: string): string {
  return tag.includes(":") ? tag.split(":").pop()! : tag;
}

function attr(el: unknown, name: string): string | undefined {
  if (!el || typeof el !== "object") return undefined;
  const rec = el as Record<string, unknown>;
  // Attributes may be namespaced; match on the local part.
  for (const key of Object.keys(rec)) {
    if (!key.startsWith(ATTR_PREFIX)) continue;
    const attrName = key.slice(ATTR_PREFIX.length);
    if (attrName === name || localNameOf(attrName) === name) {
      const v = rec[key];
      return v == null ? undefined : String(v);
    }
  }
  return undefined;
}

function childByLocalName(el: unknown, localName: string): unknown {
  if (!el || typeof el !== "object") return undefined;
  for (const [key, val] of Object.entries(el as Record<string, unknown>)) {
    if (key.startsWith(ATTR_PREFIX)) continue;
    if (localNameOf(key) === localName) return val;
  }
  return undefined;
}

type Visitor = (localName: string, rawTag: string, element: unknown) => void;

/**
 * Analyze a state's OWN body (State.Entry / State.Exit) for its invokes and
 * activity count — deliberately NOT descending into State.Transitions, because
 * REFramework nests the *next* state inside `<Transition.To>` and we must not
 * attribute a child state's invokes to its parent.
 */
function analyzeStateBody(stateEl: unknown): { rawInvokes: string[]; activityCount: number } {
  const rawInvokes: string[] = [];
  let activityCount = 0;
  for (const bodyKey of ["State.Entry", "State.Exit"]) {
    const body = childByLocalName(stateEl, bodyKey);
    if (!body) continue;
    visitElements(body, (ln, _tag, elm) => {
      if (!isPlumbing(ln)) activityCount++;
      if (ln === "InvokeWorkflowFile") {
        const wf = attr(elm, "WorkflowFileName");
        if (wf) rawInvokes.push(wf);
      }
    });
  }
  return { rawInvokes, activityCount };
}

/** Depth-first visit of every element node exactly once. */
function visitElements(container: unknown, cb: Visitor): void {
  if (Array.isArray(container)) {
    for (const item of container) visitElements(item, cb);
    return;
  }
  if (container == null || typeof container !== "object") return;
  for (const [key, val] of Object.entries(container as Record<string, unknown>)) {
    if (key.startsWith(ATTR_PREFIX) || key === "#text" || key.startsWith("?")) continue;
    const localName = localNameOf(key);
    const occurrences = Array.isArray(val) ? val : [val];
    for (const occ of occurrences) {
      cb(localName, key, occ);
      if (occ && typeof occ === "object") visitElements(occ, cb);
    }
  }
}

// ── Target classification (M0 best-effort; RISK-04: emits confidence + evidence) ──

interface ClassRule {
  system: Target["system"];
  confidence: number;
  areaAttrs?: string[]; // attribute local names to try for `area`
}

const CLASSIFIER: Record<string, ClassRule> = {
  // credentials / login
  GetSecureCredential: { system: "login", confidence: 0.9 },
  GetRobotCredential: { system: "login", confidence: 0.9 },
  RequestCredential: { system: "login", confidence: 0.9 },
  AddCredential: { system: "login", confidence: 0.85 },
  GetCredential: { system: "login", confidence: 0.9 },
  // orchestrator
  GetQueueItem: { system: "orchestrator", confidence: 0.9 },
  AddQueueItem: { system: "orchestrator", confidence: 0.9 },
  GetRobotAsset: { system: "orchestrator", confidence: 0.9, areaAttrs: ["AssetName"] },
  GetAsset: { system: "orchestrator", confidence: 0.9, areaAttrs: ["AssetName"] },
  SetTransactionStatus: { system: "orchestrator", confidence: 0.7 },
  // excel / files
  ExcelApplicationScope: { system: "excel", confidence: 0.9, areaAttrs: ["WorkbookPath"] },
  ExcelReadRange: { system: "excel", confidence: 0.85, areaAttrs: ["WorkbookPath", "SheetName"] },
  ExcelWriteRange: { system: "excel", confidence: 0.85, areaAttrs: ["WorkbookPath", "SheetName"] },
  ReadRange: { system: "excel", confidence: 0.8, areaAttrs: ["WorkbookPath", "SheetName"] },
  WriteRange: { system: "excel", confidence: 0.8, areaAttrs: ["WorkbookPath", "SheetName"] },
  CreateFile: { system: "file", confidence: 0.8, areaAttrs: ["FileName", "Path"] },
  CreateDirectory: { system: "file", confidence: 0.8, areaAttrs: ["Path", "DirectoryName"] },
  MoveFile: { system: "file", confidence: 0.8, areaAttrs: ["FileName", "Path"] },
  CopyFile: { system: "file", confidence: 0.8, areaAttrs: ["FileName", "Path"] },
  DeleteFile: { system: "file", confidence: 0.8, areaAttrs: ["FileName", "Path"] },
  SaveImage: { system: "file", confidence: 0.7, areaAttrs: ["FileName"] },
  // api / db
  HttpClient: { system: "api", confidence: 0.9, areaAttrs: ["EndPoint", "Endpoint"] },
  ExecuteQuery: { system: "database", confidence: 0.9 },
  ExecuteNonQuery: { system: "database", confidence: 0.9 },
  DatabaseConnect: { system: "database", confidence: 0.9 },
  // UI / app
  OpenApplication: { system: "web", confidence: 0.6, areaAttrs: ["FileName", "Arguments"] },
  OpenBrowser: { system: "browser", confidence: 0.85, areaAttrs: ["Url"] },
  NavigateTo: { system: "browser", confidence: 0.85, areaAttrs: ["Url"] },
  Click: { system: "web", confidence: 0.6, areaAttrs: ["Selector"] },
  TypeInto: { system: "web", confidence: 0.6, areaAttrs: ["Selector"] },
  GetText: { system: "web", confidence: 0.6, areaAttrs: ["Selector"] },
  GetFullText: { system: "web", confidence: 0.6, areaAttrs: ["Selector"] },
};

function classify(localName: string, element: unknown): Target | null {
  const rule = CLASSIFIER[localName];
  if (!rule) return null;
  let area: string | undefined;
  const evidenceParts: string[] = [`activity "${localName}"`];
  if (rule.areaAttrs) {
    for (const a of rule.areaAttrs) {
      const v = attr(element, a);
      if (v) {
        area = area ? `${area} · ${v}` : v;
        evidenceParts.push(`${a}=${v}`);
      }
    }
  }
  return {
    system: rule.system,
    area,
    activityType: localName,
    confidence: rule.confidence,
    evidence: evidenceParts.join("; "),
  };
}

// ── Arguments (x:Property under the root x:Members) ──

function directionOf(type: string): ArgumentDirection {
  if (type.startsWith("InOutArgument")) return "InOut";
  if (type.startsWith("InArgument")) return "In";
  if (type.startsWith("OutArgument")) return "Out";
  return "Property";
}

function getRootActivity(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const [key, val] of Object.entries(parsed)) {
    if (key.startsWith("?") || key.startsWith(ATTR_PREFIX)) continue;
    if (localNameOf(key) === "Activity" && val && typeof val === "object") {
      return val as Record<string, unknown>;
    }
  }
  return undefined;
}

function extractArguments(root: Record<string, unknown>): Argument[] {
  // Find the Members child regardless of prefix.
  let members: unknown;
  for (const [key, val] of Object.entries(root)) {
    if (localNameOf(key) === "Members") {
      members = val;
      break;
    }
  }
  if (!members || typeof members !== "object") return [];
  let props: unknown;
  for (const [key, val] of Object.entries(members as Record<string, unknown>)) {
    if (localNameOf(key) === "Property") {
      props = val;
      break;
    }
  }
  if (!props) return [];
  const list = Array.isArray(props) ? props : [props];
  const args: Argument[] = [];
  for (const p of list) {
    const name = attr(p, "Name");
    const type = attr(p, "Type");
    if (!name || !type) continue;
    args.push({ name, type, direction: directionOf(type) });
  }
  return args;
}

/**
 * Parse a single XAML workflow's XML string into a ParsedWorkflow.
 * @param xml    the raw `.xaml` contents
 * @param label  a human label (usually the file id) used in warnings
 */
export function parseXamlWorkflow(xml: string, label = "<workflow>"): ParsedWorkflow {
  const warnings: string[] = [];
  const activityCounts: Record<string, number> = {};
  const states: ParsedState[] = [];
  const targets: Target[] = [];
  const rawInvokes: RawInvoke[] = [];
  let activityCount = 0;

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    // RISK-01: fail loud, not silent.
    warnings.push(`${label}: XML parse failed — ${(err as Error).message}`);
    return {
      kind: "unknown",
      arguments: [],
      states: [],
      activityCounts: {},
      targets: [],
      rawInvokes: [],
      activityCount: 0,
      warnings,
    };
  }

  const root = getRootActivity(parsed);
  if (!root) {
    warnings.push(`${label}: no <Activity> root element found`);
  }

  visitElements(parsed, (localName, _rawTag, element) => {
    if (localName === "Activity") return; // the root wrapper itself is not an activity
    activityCounts[localName] = (activityCounts[localName] ?? 0) + 1;
    if (!isPlumbing(localName)) activityCount++;

    if (localName === "State" || localName === "FinalState") {
      const displayName = attr(element, "DisplayName");
      const name = attr(element, "Name") ?? displayName ?? `state-${states.length}`;
      // A terminal state is either the WF `FinalState` element or a `State`
      // carrying `IsFinal="True"` (REFramework's Main marks "End Process" this way).
      const isFinal = localName === "FinalState" || /^true$/i.test(attr(element, "IsFinal") ?? "");
      const { rawInvokes: stateInvokes, activityCount } = analyzeStateBody(element);
      states.push({ name, displayName, isFinal, rawInvokes: stateInvokes, activityCount });
    }

    if (localName === "InvokeWorkflowFile") {
      const wf = attr(element, "WorkflowFileName");
      if (wf) rawInvokes.push({ raw: wf });
      else warnings.push(`${label}: InvokeWorkflowFile without a WorkflowFileName`);
    }

    const target = classify(localName, element);
    if (target) targets.push(target);
  });

  const kind: WorkflowKind = activityCounts["StateMachine"]
    ? "stateMachine"
    : activityCounts["Flowchart"]
      ? "flowchart"
      : activityCounts["Sequence"]
        ? "sequence"
        : "unknown";

  const args = root ? extractArguments(root) : [];
  const className = root ? attr(root, "Class") : undefined;

  return {
    displayName: className,
    kind,
    arguments: args,
    states,
    activityCounts,
    targets,
    rawInvokes,
    activityCount,
    warnings,
  };
}
