/**
 * detectLanguage — deterministic language identification with recorded evidence
 * (linguist-style cascade: filename → extension → shebang). No content-model
 * guessing: if the cascade doesn't match, the honest answer is "unknown".
 */

export interface LanguageDetection {
  language: string;
  evidence: string; // e.g. "extension:.ts" | "filename:Dockerfile" | "shebang:python" | "none"
}

const FILENAME_MAP: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  rakefile: "ruby",
  gemfile: "ruby",
  "cmakelists.txt": "cmake",
  ".gitignore": "gitignore",
  ".gitattributes": "gitattributes",
  ".editorconfig": "editorconfig",
  ".env": "dotenv",
  ".env.example": "dotenv",
};

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  java: "java",
  cs: "csharp",
  csx: "csharp",
  vb: "vbnet",
  fs: "fsharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  sql: "sql",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  bat: "batch",
  cmd: "batch",
  xaml: "xaml",
  xml: "xml",
  csproj: "msbuild",
  vbproj: "msbuild",
  sln: "sln",
  props: "msbuild",
  targets: "msbuild",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "config",
  md: "markdown",
  markdown: "markdown",
  rst: "restructuredtext",
  txt: "text",
  csv: "csv",
  tsv: "csv",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  tf: "terraform",
  lua: "lua",
  r: "r",
  m: "objective-c",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  hs: "haskell",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  prisma: "prisma",
  lock: "lockfile",
};

const SHEBANG_MAP: [RegExp, string][] = [
  [/^#!.*\bpython[0-9.]*\b/, "python"],
  [/^#!.*\bnode\b/, "javascript"],
  [/^#!.*\b(bash|sh|zsh)\b/, "shell"],
  [/^#!.*\bruby\b/, "ruby"],
  [/^#!.*\bperl\b/, "perl"],
  [/^#!.*\bpwsh\b/, "powershell"],
];

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function detectLanguage(path: string, firstLine?: string): LanguageDetection {
  const name = basename(path).toLowerCase();

  const byFilename = FILENAME_MAP[name];
  if (byFilename) return { language: byFilename, evidence: `filename:${name}` };

  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    const byExt = EXTENSION_MAP[ext];
    if (byExt) return { language: byExt, evidence: `extension:.${ext}` };
  }

  if (firstLine && firstLine.startsWith("#!")) {
    for (const [re, lang] of SHEBANG_MAP) {
      if (re.test(firstLine)) return { language: lang, evidence: `shebang:${lang}` };
    }
  }

  return { language: "unknown", evidence: "none" };
}
