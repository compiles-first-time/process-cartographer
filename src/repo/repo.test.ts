/**
 * U0 acceptance tests (ADR-0055): the universal tier-0 pipeline.
 * Invariants here operationalize the accuracy contract — determinism,
 * partition sums, no silent omission, boundary validation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleRepoIR, type RepoRawFile } from "./assembleRepoIR.ts";
import { detectLanguage } from "./detectLanguage.ts";
import { classifyFile, excludedDirOf } from "./hygiene.ts";
import { validateRepoIR } from "../ir/repoSchema.ts";
import { buildRepoCityModel } from "../model/repoCityModel.ts";
import { buildLoaded, isUiPathProject, loadFromIRJson } from "../ingest/buildIR.ts";
import { collectXamlFiles } from "../parser/loadProject.ts";
import type { IngestedProject } from "../ingest/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");
const META = { name: "test-repo", source: "test" };

const SYNTHETIC: RepoRawFile[] = [
  { path: "src/app.ts", text: 'import { x } from "./util";\nexport const a = 1;\n' },
  { path: "src/util.ts", text: "export const x = 2;\n\n// comment\n" },
  { path: "src/legacy.js", text: "module.exports = 1;\n" },
  { path: "tools/run.py", text: "import os\nprint('hi')\n" },
  { path: "README.md", text: "# Title\n\nBody\n" },
  { path: "assets/logo.png", bytes: 5000 }, // binary by extension, no text
  { path: "node_modules/dep/index.js", text: "junk" }, // excluded dir
  { path: "big.sql", text: "SELECT 1;\n", bytes: 2_000_000 }, // over size cap
];

describe("detectLanguage", () => {
  it("detects by extension, filename, and shebang — with evidence", () => {
    expect(detectLanguage("a/b/c.ts")).toEqual({ language: "typescript", evidence: "extension:.ts" });
    expect(detectLanguage("Dockerfile")).toEqual({ language: "dockerfile", evidence: "filename:dockerfile" });
    expect(detectLanguage("bin/tool", "#!/usr/bin/env python3")).toEqual({ language: "python", evidence: "shebang:python" });
    expect(detectLanguage("mystery")).toEqual({ language: "unknown", evidence: "none" });
  });
});

describe("hygiene", () => {
  it("classifies binaries, minified assets, and oversize files with reasons", () => {
    expect(classifyFile("x.png").included).toBe(false);
    expect(classifyFile("app.min.js").included).toBe(false);
    expect(classifyFile("big.sql", 2_000_000).included).toBe(false);
    expect(classifyFile("src/app.ts", 500).included).toBe(true);
  });
  it("finds excluded dirs at any depth", () => {
    expect(excludedDirOf("node_modules/x/y.js")).toBe("node_modules");
    expect(excludedDirOf("a/b/node_modules/x.js")).toBe("a/b/node_modules");
    expect(excludedDirOf("src/app.ts")).toBeNull();
  });
});

describe("assembleRepoIR (tier-0)", () => {
  const ir = assembleRepoIR(META, SYNTHETIC);

  it("emits a schema-valid RepoIR", () => {
    expect(() => validateRepoIR(ir)).not.toThrow();
    expect(ir.irKind).toBe("repo");
  });

  it("is deterministic and order-independent", () => {
    const again = assembleRepoIR(META, SYNTHETIC);
    expect(again).toEqual(ir);
    const shuffled = [...SYNTHETIC].reverse();
    expect(assembleRepoIR(META, shuffled)).toEqual(ir);
  });

  it("never silently omits: skips are visible files, exclusions are summarized", () => {
    // Excluded dir pruned wholesale but disclosed with entry count.
    expect(ir.diagnostics.excludedDirs).toEqual([
      { dir: "node_modules", rule: "excluded directory name: node_modules", entries: 1 },
    ]);
    // Binary + oversize render as skipped buildings with reasons.
    const png = ir.files.find((f) => f.path === "assets/logo.png")!;
    expect(png.parseStatus).toBe("skipped");
    expect(png.skipReason).toContain("binary");
    const sql = ir.files.find((f) => f.path === "big.sql")!;
    expect(sql.parseStatus).toBe("skipped");
    expect(sql.skipReason).toContain("size cap");
    // Everything that survived pruning is in the IR: 7 files (8 raw - 1 excluded).
    expect(ir.files.length).toBe(7);
    expect(ir.diagnostics.filesSkipped).toBe(2);
  });

  it("LOC partition sum: file lines sum to locTotal; language aggregates match", () => {
    const sum = ir.files.reduce((n, f) => n + f.lines, 0);
    expect(sum).toBe(ir.diagnostics.locTotal);
    const langSum = Object.values(ir.diagnostics.languages).reduce((n, l) => n + l.loc, 0);
    expect(langSum).toBe(ir.diagnostics.locTotal);
    const ts = ir.files.find((f) => f.path === "src/app.ts")!;
    expect(ts.lines).toBe(2);
    expect(ts.language).toBe("typescript");
  });

  it("declares its counting rule and hygiene assumptions (scorecard provenance)", () => {
    expect(ir.diagnostics.locRule).toContain("physical");
    expect(ir.diagnostics.assumptions.length).toBeGreaterThanOrEqual(2);
  });

  it("emits no edges at U0 (nothing invented)", () => {
    expect(ir.edges).toEqual([]);
  });
});

describe("buildRepoCityModel", () => {
  const ir = assembleRepoIR(META, SYNTHETIC);
  const city = buildRepoCityModel(ir);

  it("maps dirs to districts and files to buildings with LOC weights", () => {
    expect(city.kind).toBe("city");
    const districts = city.children.filter((c) => c.kind === "district" && !c.excludedDir);
    const files = city.children.filter((c) => c.kind === "file");
    expect(districts.map((d) => d.label).sort()).toEqual(["assets", "src", "tools"]);
    expect(files.map((f) => f.label).sort()).toEqual(["README.md", "big.sql"]);
    const src = districts.find((d) => d.label === "src")!;
    expect(src.children.length).toBe(3);
    expect(src.weight).toBe(src.children.reduce((n, c) => n + c.weight, 0));
    // The pruned node_modules is VISIBLE as a ghost district (never silent).
    const ghost = city.children.find((c) => c.excludedDir);
    expect(ghost?.excludedDir?.dir).toBe("node_modules");
  });

  it("marks skipped files honestly in their zone summary", () => {
    const assets = city.children.find((c) => c.label === "assets")!;
    const logo = assets.children[0];
    expect(logo.summary).toContain("skipped");
  });

  it("is deterministic", () => {
    expect(buildRepoCityModel(ir)).toEqual(city);
  });
});

describe("pipeline routing (buildLoaded)", () => {
  it("routes the vendored REFramework to the UiPath pipeline (regression)", () => {
    const xamlFiles = collectXamlFiles(FIXTURE);
    const projectJson = readFileSync(path.join(FIXTURE, "project.json"), "utf8");
    const ingested: IngestedProject = {
      rootName: "reframework",
      xamlFiles,
      projectJson,
      allFiles: xamlFiles.map((f) => ({ path: f.id, text: f.xml })),
      sourceLabel: "test",
      notes: [],
    };
    expect(isUiPathProject(ingested)).toBe(true);
    const loaded = buildLoaded(ingested);
    expect(loaded.kind).toBe("uipath");
    if (loaded.kind === "uipath") {
      expect(loaded.ir.workflows.find((w) => w.id === "Main.xaml")?.kind).toBe("stateMachine");
    }
  });

  it("routes a plain code repo to the repo pipeline", () => {
    const ingested: IngestedProject = {
      rootName: "some-repo",
      xamlFiles: [],
      allFiles: SYNTHETIC,
      sourceLabel: "test",
      notes: [],
    };
    expect(isUiPathProject(ingested)).toBe(false);
    const loaded = buildLoaded(ingested);
    expect(loaded.kind).toBe("repo");
    if (loaded.kind === "repo") expect(loaded.ir.files.length).toBe(7);
  });

  it("does NOT mistake an Nx-style project.json repo for UiPath", () => {
    const ingested: IngestedProject = {
      rootName: "nx-repo",
      xamlFiles: [{ id: "stray/Legacy.xaml", xml: "<Activity xmlns=\"http://schemas.microsoft.com/netfx/2009/xaml/activities\"/>" }],
      projectJson: JSON.stringify({ name: "web-app", targets: { build: {} } }),
      allFiles: [
        ...SYNTHETIC,
        { path: "stray/Legacy.xaml", text: "<Activity/>" },
        { path: "project.json", text: JSON.stringify({ name: "web-app", targets: { build: {} } }) },
      ],
      sourceLabel: "test",
      notes: [],
    };
    expect(isUiPathProject(ingested)).toBe(false);
  });
});

describe("loadFromIRJson (the CLI/CI interop seam)", () => {
  it("round-trips a RepoIR and rejects garbage with a precise error", () => {
    const ir = assembleRepoIR(META, SYNTHETIC);
    const loaded = loadFromIRJson(JSON.stringify(ir));
    expect(loaded.kind).toBe("repo");
    if (loaded.kind === "repo") expect(loaded.ir).toEqual(ir);

    expect(() => loadFromIRJson("not json")).toThrow(/Not valid JSON/);
    expect(() => loadFromIRJson('{"hello":"world"}')).toThrow(/Unrecognized IR JSON/);
    // A shape-corrupted RepoIR must fail boundary validation, not render.
    const corrupt = { ...ir, files: [{ path: 1 }] };
    expect(() => loadFromIRJson(JSON.stringify(corrupt))).toThrow();
  });
});

describe("real-tree sanity: the vendored REFramework as a plain repo", () => {
  it("survives tier-0 assembly with honest xlsx skips", () => {
    const files = collectXamlFiles(FIXTURE).map((f) => ({ path: f.id, text: f.xml }));
    const withBinary: RepoRawFile[] = [...files, { path: "Data/Config.xlsx", bytes: 12345 }];
    const ir = assembleRepoIR({ name: "reframework-as-repo", source: "test" }, withBinary);
    expect(ir.files.length).toBe(withBinary.length);
    const xlsx = ir.files.find((f) => f.path === "Data/Config.xlsx")!;
    expect(xlsx.parseStatus).toBe("skipped");
    const langs = Object.keys(ir.diagnostics.languages);
    expect(langs).toContain("xaml");
  });
});
