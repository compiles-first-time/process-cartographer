/**
 * B1 tests: compiler-grade TS resolution (ts.resolveModuleName + in-memory host).
 * The exact gap this closes: tsconfig `paths` aliases previously fell to
 * `external`; now they resolve `resolved-static` — the compiler's own answer.
 */
import { describe, it, expect } from "vitest";
import { computeTsOverrides } from "./tsResolver.ts";
import { overrideKey } from "../resolveImports.ts";
import { assembleRepoIR, type RepoRawFile } from "../assembleRepoIR.ts";
import type { FileSyntax } from "./facts.ts";
import type { ImportFact } from "../../ir/repoSchema.ts";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    baseUrl: ".",
    paths: { "@lib/*": ["src/lib/*"], "@core": ["src/core/index.ts"] },
  },
});

const FILES: RepoRawFile[] = [
  { path: "tsconfig.json", text: TSCONFIG },
  { path: "src/app.ts", text: "x\n" },
  { path: "src/lib/util.ts", text: "x\n" },
  { path: "src/core/index.ts", text: "x\n" },
  { path: "src/other.ts", text: "x\n" },
];

const imp = (specifier: string, line: number, dynamic = false): ImportFact => ({ specifier, line, dynamic });
const APP_IMPORTS: ImportFact[] = [
  imp("@lib/util", 1), // paths alias with wildcard
  imp("@core", 2), // paths alias, exact
  imp("./other", 3), // plain relative (compiler also answers)
  imp("react", 4), // real external — must NOT resolve
  imp("cfg.plugin", 5, true), // dynamic — never touched
];

function makeInputs() {
  const paths = FILES.map((f) => f.path);
  const textByPath = new Map(FILES.map((f) => [f.path, f.text!]));
  const importsByFile = new Map<string, ImportFact[]>([["src/app.ts", APP_IMPORTS]]);
  return { paths, textByPath, importsByFile };
}

describe("computeTsOverrides (B1)", () => {
  const { paths, textByPath, importsByFile } = makeInputs();
  const res = computeTsOverrides(paths, textByPath, importsByFile);

  it("resolves tsconfig paths aliases to in-repo files (compiler answer)", () => {
    expect(res.overrides.get(overrideKey("src/app.ts", "@lib/util"))).toBe("src/lib/util.ts");
    expect(res.overrides.get(overrideKey("src/app.ts", "@core"))).toBe("src/core/index.ts");
    expect(res.overrides.get(overrideKey("src/app.ts", "./other"))).toBe("src/other.ts");
  });

  it("never claims external packages or dynamic imports", () => {
    expect(res.overrides.get(overrideKey("src/app.ts", "react"))).toBeUndefined();
    expect(res.overrides.get(overrideKey("src/app.ts", "cfg.plugin"))).toBeUndefined();
  });

  it("discloses the tsconfig it honored", () => {
    expect(res.assumptions.some((a) => a.includes("tsconfig.json"))).toBe(true);
  });

  it("works without a tsconfig (Bundler-mode defaults, disclosed)", () => {
    const noCfg = computeTsOverrides(
      paths.filter((p) => p !== "tsconfig.json"),
      textByPath,
      importsByFile,
    );
    // Aliases can't resolve without paths config — honestly absent, not guessed.
    expect(noCfg.overrides.get(overrideKey("src/app.ts", "@lib/util"))).toBeUndefined();
    // Relative still resolves.
    expect(noCfg.overrides.get(overrideKey("src/app.ts", "./other"))).toBe("src/other.ts");
    expect(noCfg.assumptions.some((a) => a.includes("no tsconfig found"))).toBe(true);
  });
});

describe("B1 end-to-end: aliases become resolved-static edges in the IR", () => {
  it("upgrades alias imports that previously fell to external", () => {
    const { paths, textByPath, importsByFile } = makeInputs();
    const syntax = new Map<string, FileSyntax>([
      ["src/app.ts", { symbols: [], imports: APP_IMPORTS, parseClean: true }],
    ]);
    const { overrides, assumptions } = computeTsOverrides(paths, textByPath, importsByFile);
    const ir = assembleRepoIR({ name: "b1", source: "t" }, FILES, {
      syntax,
      tsOverrides: overrides,
      extraAssumptions: assumptions,
    });

    const statics = ir.edges.filter((e) => e.kind === "import" && e.resolution === "resolved-static");
    expect(statics.map((e) => e.to).sort()).toEqual(["src/core/index.ts", "src/lib/util.ts", "src/other.ts"]);
    // react stays external; dynamic stays unresolved-dynamic.
    expect(ir.edges.find((e) => e.to === "react")?.resolution).toBe("external");
    expect(ir.edges.find((e) => e.to === "cfg.plugin")?.resolution).toBe("unresolved-dynamic");
    // The compiler-resolution assumption reaches the scorecard.
    expect(ir.diagnostics.assumptions.some((a) => a.includes("ts.resolveModuleName"))).toBe(true);
  });
});
