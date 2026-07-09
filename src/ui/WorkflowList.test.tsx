// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { loadProject } from "../parser/loadProject.ts";
import { computeCityLayout } from "../layout/cityLayout.ts";
import WorkflowList from "./WorkflowList.tsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");
const layout = computeCityLayout(loadProject(FIXTURE));

afterEach(cleanup);

describe("WorkflowList (accessible non-3D fallback)", () => {
  it("renders a labeled table row per workflow", () => {
    render(<WorkflowList layout={layout} matchedIds={null} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole("region", { name: /workflow list/i })).toBeTruthy();
    const bodyRows = screen.getAllByRole("row").filter((r) => within(r).queryAllByRole("cell").length > 0);
    expect(bodyRows.length).toBe(layout.buildings.length);
    expect(screen.getByText("Main.xaml", { exact: false })).toBeTruthy();
  });

  it("filters to the matched set", () => {
    const only = new Set(["Main.xaml"]);
    render(<WorkflowList layout={layout} matchedIds={only} selectedId={null} onSelect={() => {}} />);
    const bodyRows = screen.getAllByRole("row").filter((r) => within(r).queryAllByRole("cell").length > 0);
    expect(bodyRows.length).toBe(1);
  });

  it("selects on click and is keyboard-operable", () => {
    const onSelect = vi.fn();
    render(<WorkflowList layout={layout} matchedIds={new Set(["Main.xaml"])} selectedId={null} onSelect={onSelect} />);
    const row = screen.getAllByRole("row").find((r) => within(r).queryAllByRole("cell").length > 0)!;
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("Main.xaml");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
