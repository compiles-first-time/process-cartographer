import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { parseGithubUrl, ingestFromGithub } from "./fromGithub.ts";
import { normalizeProject } from "./normalize.ts";
import { ingestFromNupkgBytes } from "./fromNupkg.ts";
import { buildIR } from "./buildIR.ts";
import { collectXamlFiles, loadProject } from "../parser/loadProject.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");

describe("parseGithubUrl", () => {
  it("parses full URLs, shorthand, and tree/subdir forms", () => {
    expect(parseGithubUrl("https://github.com/UiPath/ReFrameWork")).toEqual({ owner: "UiPath", repo: "ReFrameWork" });
    expect(parseGithubUrl("UiPath/ReFrameWork")).toEqual({ owner: "UiPath", repo: "ReFrameWork" });
    expect(parseGithubUrl("https://github.com/o/r.git")).toEqual({ owner: "o", repo: "r" });
    expect(parseGithubUrl("https://github.com/o/r/tree/dev/sub/dir")).toEqual({
      owner: "o",
      repo: "r",
      branch: "dev",
      subdir: "sub/dir",
    });
    expect(parseGithubUrl("https://gitlab.com/o/r")).toBeNull();
    expect(parseGithubUrl("not a url")).toBeNull();
  });
});

describe("normalizeProject", () => {
  it("re-roots files to the project.json directory", () => {
    const res = normalizeProject([
      { path: "Wrapper/project.json", text: "{}" },
      { path: "Wrapper/Main.xaml", text: "<Activity/>" },
      { path: "Wrapper/Framework/Init.xaml", text: "<Activity/>" },
      { path: "Wrapper/README.md", text: "ignore me" },
    ]);
    expect(res.projectJson).toBe("{}");
    const ids = res.xamlFiles.map((f) => f.id).sort();
    expect(ids).toEqual(["Framework/Init.xaml", "Main.xaml"]);
  });

  it("falls back to the common dir when no project.json exists", () => {
    const res = normalizeProject([
      { path: "Proj/A.xaml", text: "<Activity/>" },
      { path: "Proj/sub/B.xaml", text: "<Activity/>" },
    ]);
    expect(res.projectJson).toBeUndefined();
    expect(res.xamlFiles.map((f) => f.id).sort()).toEqual(["A.xaml", "sub/B.xaml"]);
    expect(res.notes.some((n) => /No project\.json/.test(n))).toBe(true);
  });
});

describe("GitHub ingest (mocked fetch)", () => {
  function jsonRes(body: unknown) {
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  }
  function textRes(text: string, status = 200) {
    return { ok: status < 400, status, headers: { get: () => null }, text: async () => text } as unknown as Response;
  }

  it("fetches all hygiene-passing files, skips binaries via tree metadata, and retries on 429", async () => {
    let mainHits = 0;
    const mockFetch = (async (url: string) => {
      if (url.includes("/git/trees/")) {
        return jsonRes({
          truncated: false,
          tree: [
            { path: "project.json", type: "blob", size: 40 },
            { path: "Main.xaml", type: "blob", size: 100 },
            { path: "README.md", type: "blob", size: 20 }, // universal adapter fetches this too
            { path: "logo.png", type: "blob", size: 5000 }, // binary — must NOT be fetched
            { path: "node_modules/x/i.js", type: "blob", size: 10 }, // excluded dir — must NOT be fetched
          ],
        });
      }
      if (url.endsWith("/main/project.json")) return textRes(`{"id":"Demo","main":"Main.xaml"}`);
      if (url.endsWith("/main/README.md")) return textRes("# Demo\n");
      if (url.endsWith("/main/Main.xaml")) {
        mainHits++;
        if (mainHits === 1) return textRes("", 429); // first attempt rate-limited
        return textRes(`<Activity xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities"/>`);
      }
      return textRes("nope", 404); // any other fetch (logo.png, node_modules) would fail the test
    }) as unknown as typeof fetch;

    const ingested = await ingestFromGithub("https://github.com/UiPath/ReFrameWork/tree/main", { fetchImpl: mockFetch });
    expect(ingested.xamlFiles.map((f) => f.id)).toEqual(["Main.xaml"]);
    expect(ingested.projectJson).toContain("Demo");
    expect(mainHits).toBe(2); // proves the 429 retry happened
    // Universal view: all 5 paths present; binary + excluded carry no text.
    const byPath = new Map(ingested.allFiles!.map((f) => [f.path, f]));
    expect(byPath.size).toBe(5);
    expect(byPath.get("README.md")!.text).toContain("# Demo");
    expect(byPath.get("logo.png")!.text).toBeUndefined();
    expect(byPath.get("logo.png")!.skipReason).toContain("binary");
    expect(byPath.get("node_modules/x/i.js")!.text).toBeUndefined();
  });
});

describe(".nupkg ingest — end-to-end parity with the Node loader", () => {
  it("zipping the fixture under a wrapper folder yields the same IR", () => {
    // Build a synthetic .nupkg from the vendored REFramework, nested under a
    // wrapper folder + NuGet plumbing (to exercise re-rooting + filtering).
    const files = collectXamlFiles(FIXTURE);
    const zipInput: Record<string, Uint8Array> = {
      "[Content_Types].xml": strToU8("<Types/>"),
      "_rels/.rels": strToU8("<Relationships/>"),
      "REFrameWork.nuspec": strToU8("<package/>"),
      "content/project.json": strToU8(readFileSync(path.join(FIXTURE, "project.json"), "utf8")),
    };
    for (const f of files) zipInput[`content/${f.id}`] = strToU8(f.xml);
    const bytes = zipSync(zipInput);

    const ingested = ingestFromNupkgBytes(bytes, "REFrameWork.nupkg");
    expect(ingested.xamlFiles.length).toBe(files.length);
    expect(ingested.projectJson).toBeTruthy();

    const irFromNupkg = buildIR(ingested);
    const irFromDisk = loadProject(FIXTURE);

    // Same graph shape from both ingest paths.
    expect(irFromNupkg.diagnostics.workflowsParsed).toBe(irFromDisk.diagnostics.workflowsParsed);
    expect(irFromNupkg.diagnostics.invokeEdges).toBe(irFromDisk.diagnostics.invokeEdges);
    expect(irFromNupkg.workflows.find((w) => w.id === "Main.xaml")?.kind).toBe("stateMachine");
    // Plumbing (nuspec, _rels, [Content_Types]) was filtered out.
    expect(ingested.xamlFiles.every((f) => f.id.endsWith(".xaml"))).toBe(true);
  });
});
