/**
 * facts — pure per-file syntactic fact extraction from a tree-sitter CST
 * (ADR-0055 Tier-1/U1: "parser-proved facts about the text", JS/TS grammars).
 *
 * What this extracts (and ONLY this — no resolution, no cross-file linking):
 *  - declarations (functions, classes, methods, interfaces, types, enums)
 *    with names + line spans;
 *  - import/require/re-export statements AS WRITTEN, with the literal
 *    specifier, or `dynamic: true` when the specifier is not a string literal
 *    (the Tier-3 signal — never a guessed target);
 *  - parse cleanliness (ERROR/MISSING presence).
 *
 * Environment-agnostic: takes a parsed tree's root node (web-tree-sitter API,
 * identical in Node and browser).
 */
import type { Node as TSNode } from "web-tree-sitter";
import type { SymbolInfo, ImportFact } from "../../ir/repoSchema.ts";

export interface FileSyntax {
  symbols: SymbolInfo[];
  imports: ImportFact[];
  parseClean: boolean;
}

const MAX_SPECIFIER_LEN = 120;

function line(n: TSNode): number {
  return n.startPosition.row + 1; // rows are 0-based; IR lines are 1-based
}

function endLine(n: TSNode): number {
  return n.endPosition.row + 1;
}

function nameOf(n: TSNode): string | null {
  const nameNode = n.childForFieldName("name");
  return nameNode ? nameNode.text : null;
}

function stringLiteralText(n: TSNode): string | null {
  if (n.type !== "string") return null;
  // string → string_fragment children (may be empty for "")
  const frag = n.namedChildren.find((c) => c && c.type === "string_fragment");
  return frag ? frag.text : "";
}

/** Symbol collection: top-level, export-wrapped, and class-body declarations.
 *  Deliberately does NOT descend into function bodies (inner helpers are
 *  implementation detail, not building structure). */
function collectSymbols(root: TSNode, out: SymbolInfo[]): void {
  const visit = (node: TSNode, container: string | null) => {
    for (const child of node.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case "export_statement":
        case "ambient_declaration": // TS `declare ...`
          visit(child, container);
          break;
        case "function_declaration":
        case "generator_function_declaration": {
          const name = nameOf(child);
          if (name) out.push({ name, kind: "function", startLine: line(child), endLine: endLine(child) });
          break;
        }
        case "class_declaration":
        case "abstract_class_declaration": {
          const name = nameOf(child);
          if (name) {
            out.push({ name, kind: "class", startLine: line(child), endLine: endLine(child) });
            const body = child.childForFieldName("body");
            if (body) {
              for (const m of body.namedChildren) {
                if (m && m.type === "method_definition") {
                  const mName = nameOf(m);
                  if (mName) out.push({ name: `${name}.${mName}`, kind: "method", startLine: line(m), endLine: endLine(m) });
                }
              }
            }
          }
          break;
        }
        case "interface_declaration": {
          const name = nameOf(child);
          if (name) out.push({ name, kind: "interface", startLine: line(child), endLine: endLine(child) });
          break;
        }
        case "type_alias_declaration": {
          const name = nameOf(child);
          if (name) out.push({ name, kind: "type", startLine: line(child), endLine: endLine(child) });
          break;
        }
        case "enum_declaration": {
          const name = nameOf(child);
          if (name) out.push({ name, kind: "enum", startLine: line(child), endLine: endLine(child) });
          break;
        }
        case "internal_module": {
          // TS namespace — recurse into its body for members.
          const name = nameOf(child);
          if (name) out.push({ name, kind: "namespace", startLine: line(child), endLine: endLine(child) });
          const body = child.namedChildren.find((c) => c && c.type === "statement_block");
          if (body) visit(body, name);
          break;
        }
        case "lexical_declaration":
        case "variable_declaration": {
          // Only function-valued declarators (const f = () => {}) — data consts are noise.
          for (const d of child.namedChildren) {
            if (!d || d.type !== "variable_declarator") continue;
            const value = d.childForFieldName("value");
            const name = nameOf(d);
            if (name && value && (value.type === "arrow_function" || value.type === "function_expression" || value.type === "generator_function")) {
              out.push({ name, kind: "function", startLine: line(d), endLine: endLine(d) });
            }
          }
          break;
        }
        default:
          break;
      }
    }
  };
  visit(root, null);
}

/** Import collection: FULL-tree walk (dynamic import() can occur anywhere). */
function collectImports(root: TSNode, out: ImportFact[]): void {
  const stack: TSNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === "import_statement" || node.type === "export_statement") {
      // `import ... from "x"` / `export ... from "x"` (re-export = an import fact)
      const source = node.childForFieldName("source");
      if (source) {
        const lit = stringLiteralText(source);
        if (lit != null) out.push({ specifier: lit, line: line(node), dynamic: false });
      }
    } else if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      const isDynImport = fn?.type === "import";
      const isRequire = fn?.type === "identifier" && fn.text === "require";
      if (isDynImport || isRequire) {
        const args = node.childForFieldName("arguments");
        const first = args?.namedChildren.find((c) => c != null) ?? null;
        const lit = first ? stringLiteralText(first) : null;
        if (lit != null) {
          // Literal specifier: the target is written in the source (statically knowable).
          out.push({ specifier: lit, line: line(node), dynamic: false });
        } else {
          // Non-literal: honestly dynamic — record the expression text, never a guess.
          const expr = (first?.text ?? node.text).slice(0, MAX_SPECIFIER_LEN);
          out.push({ specifier: expr, line: line(node), dynamic: true });
        }
      }
    }
    for (const c of node.namedChildren) if (c) stack.push(c);
  }
  // Deterministic order regardless of traversal: by line, then specifier.
  out.sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier));
}

export function extractFacts(root: TSNode): FileSyntax {
  const symbols: SymbolInfo[] = [];
  const imports: ImportFact[] = [];
  collectSymbols(root, symbols);
  collectImports(root, imports);
  symbols.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
  return { symbols, imports, parseClean: !root.hasError };
}

/** Which grammar a file needs, by extension (null = not syntax-eligible in U1). */
export function grammarFor(path: string): "typescript" | "tsx" | "javascript" | null {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return null;
  switch (m[1].toLowerCase()) {
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    default:
      return null;
  }
}
