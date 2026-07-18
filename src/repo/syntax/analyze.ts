/**
 * analyze — run the U1 syntax tier over a set of files with a provided
 * grammar loader (environment-specific: Node resolves node_modules paths,
 * the browser imports vite `?url` assets). Memory discipline per ADR-0055:
 * parse → extract → tree.delete() immediately; trees never accumulate.
 *
 * U1 runs on the main thread (30k LOC ≈ 0.15 s measured, ~250k lines/s);
 * a Web Worker pool is a U2+ perf upgrade, not a correctness need.
 */
import { Parser, Language } from "web-tree-sitter";
import { extractFacts, grammarFor, type FileSyntax, type GrammarKind } from "./facts.ts";

export type GrammarId = GrammarKind;

export interface SyntaxEnv {
  /** Resolve the runtime wasm location (browser: vite url; Node: default). */
  locateRuntime?: (file: string) => string;
  /** Load a grammar's wasm bytes/URL for Language.load. */
  grammarSource: (g: GrammarId) => Promise<string | Uint8Array>;
}

export interface AnalyzableFile {
  path: string;
  text: string;
}

let initialized = false;
const languages = new Map<GrammarId, Language>();

async function ensureLanguage(g: GrammarId, env: SyntaxEnv): Promise<Language> {
  if (!initialized) {
    await Parser.init(
      env.locateRuntime ? { locateFile: (f: string) => env.locateRuntime!(f) } : undefined,
    );
    initialized = true;
  }
  let lang = languages.get(g);
  if (!lang) {
    const src = await env.grammarSource(g);
    lang = await Language.load(src as never);
    languages.set(g, lang);
  }
  return lang;
}

/**
 * Analyze every syntax-eligible file. Returns per-path facts. Files whose
 * grammar fails to load are OMITTED from the map (they stay "not-analyzed"
 * in the IR, with a warning at the call site — fail loud, degrade honest).
 */
export async function analyzeFiles(
  files: AnalyzableFile[],
  env: SyntaxEnv,
  onProgress?: (done: number, total: number) => void,
): Promise<{ facts: Map<string, FileSyntax>; warnings: string[] }> {
  const facts = new Map<string, FileSyntax>();
  const warnings: string[] = [];
  const eligible = files
    .map((f) => ({ ...f, grammar: grammarFor(f.path) }))
    .filter((f): f is AnalyzableFile & { grammar: GrammarId } => f.grammar != null);

  const failedGrammars = new Set<GrammarId>();
  const parser = new (await parserCtor(env))();
  try {
    let done = 0;
    for (const f of eligible) {
      if (failedGrammars.has(f.grammar)) continue;
      let lang: Language;
      try {
        lang = await ensureLanguage(f.grammar, env);
      } catch (err) {
        failedGrammars.add(f.grammar);
        warnings.push(`Grammar "${f.grammar}" failed to load (${(err as Error).message}) — its files remain not-analyzed.`);
        continue;
      }
      parser.setLanguage(lang);
      const tree = parser.parse(f.text);
      if (!tree) {
        warnings.push(`${f.path}: parser returned no tree — left not-analyzed.`);
        continue;
      }
      try {
        facts.set(f.path, extractFacts(tree.rootNode, f.grammar));
      } finally {
        tree.delete(); // memory discipline: never retain trees
      }
      onProgress?.(++done, eligible.length);
    }
  } finally {
    parser.delete();
  }
  return { facts, warnings };
}

async function parserCtor(env: SyntaxEnv): Promise<typeof Parser> {
  if (!initialized) {
    await Parser.init(
      env.locateRuntime ? { locateFile: (f: string) => env.locateRuntime!(f) } : undefined,
    );
    initialized = true;
  }
  return Parser;
}
