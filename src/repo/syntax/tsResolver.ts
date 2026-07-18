/**
 * tsResolver — B1: compiler-grade TS/JS module resolution (ADR-0055 Tier-1).
 *
 * Uses the REAL TypeScript compiler's `ts.resolveModuleName` over an in-memory
 * ModuleResolutionHost built from the ingested file set, honoring the repo's
 * own tsconfig/jsconfig (`baseUrl`, `paths` aliases, moduleResolution mode).
 * This is the same resolution `tsc` itself performs — no reimplementation.
 *
 * IMPORTANT (bundle discipline): this module imports `typescript` (~large) and
 * must only ever be reached via dynamic import so it stays in its own chunk —
 * and `typescript` must be listed in vite optimizeDeps.include (the dep-
 * discovery-reload lesson, 2026-07-18).
 *
 * Output is an OVERRIDES map consumed by resolveImportEdges — assembleRepoIR
 * stays pure/sync; the compiler's answer upgrades an edge to `resolved-static`
 * only when the target is a file in the ingested set (never node_modules).
 */
import ts from "typescript";
import type { ImportFact } from "../../ir/repoSchema.ts";
import { overrideKey } from "../resolveImports.ts";

export interface TsOverridesResult {
  /** key = overrideKey(fromPath, specifier) -> resolved repo-relative target path. */
  overrides: Map<string, string>;
  assumptions: string[];
  warnings: string[];
}

const TS_JS_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

function strip(p: string): string {
  // Trailing slashes too: for a bare "." import TS probes directoryExists
  // with "dir/" — without normalizing, the prefix check built "dir//" and the
  // probe failed, so `import x from "."` never resolved (found by the B2
  // oracle differential on vuejs/core, 2026-07-18: 3 unanimous-oracle edges
  // missing, all `from "."`).
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function computeTsOverrides(
  filePaths: string[],
  textByPath: Map<string, string>,
  importsByFile: Map<string, ImportFact[]>,
): TsOverridesResult {
  const overrides = new Map<string, string>();
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const fileSet = new Set(filePaths);

  // Shallowest tsconfig/jsconfig wins (repo-root config governs the repo).
  const configPath = filePaths
    .filter((p) => /(^|\/)(tsconfig|jsconfig)\.json$/.test(p))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];

  let options: ts.CompilerOptions = {};
  if (configPath) {
    const text = textByPath.get(configPath);
    if (text) {
      const parsed = ts.parseConfigFileTextToJson(configPath, text);
      if (parsed.error) {
        warnings.push(`tsconfig at ${configPath} did not parse — compiler resolution ran with defaults.`);
      } else {
        const dir = "/" + (configPath.includes("/") ? configPath.slice(0, configPath.lastIndexOf("/")) : "");
        const conv = ts.convertCompilerOptionsFromJson(
          (parsed.config as { compilerOptions?: unknown }).compilerOptions ?? {},
          dir,
          configPath,
        );
        options = conv.options;
      }
    }
  }
  if (options.moduleResolution == null) {
    options.moduleResolution = ts.ModuleResolutionKind.Bundler;
  }
  options.allowJs = options.allowJs ?? true;
  options.resolveJsonModule = options.resolveJsonModule ?? true;

  const host: ts.ModuleResolutionHost = {
    fileExists: (p) => fileSet.has(strip(p)),
    readFile: (p) => textByPath.get(strip(p)),
    directoryExists: (p) => {
      const d = strip(p);
      if (d === "") return true;
      const prefix = d + "/";
      for (const f of fileSet) if (f.startsWith(prefix)) return true;
      return false;
    },
    useCaseSensitiveFileNames: () => true,
  };

  const cache = ts.createModuleResolutionCache("/", (s) => s, options);

  for (const from of filePaths) {
    if (!TS_JS_RE.test(from)) continue;
    const imports = importsByFile.get(from);
    if (!imports?.length) continue;
    for (const imp of imports) {
      if (imp.dynamic) continue;
      const r = ts.resolveModuleName(imp.specifier, "/" + from, options, host, cache);
      const rm = r.resolvedModule;
      if (!rm || rm.isExternalLibraryImport) continue;
      const target = strip(rm.resolvedFileName);
      if (fileSet.has(target) && target !== from) {
        overrides.set(overrideKey(from, imp.specifier), target);
      }
    }
  }

  assumptions.push(
    configPath
      ? `TS/JS import edges resolved by the TypeScript compiler (ts.resolveModuleName) honoring ${configPath} (baseUrl/paths/moduleResolution)`
      : "TS/JS import edges resolved by the TypeScript compiler (ts.resolveModuleName) with default Bundler resolution (no tsconfig found)",
  );
  return { overrides, assumptions, warnings };
}
