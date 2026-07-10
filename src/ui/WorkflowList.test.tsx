// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { loadProject } from "../parser/loadProject.ts";
import { buildCityModel } from "../model/cityModel.ts";
import { computeLayout } from "../layout/cityLayout.ts";
import ZoneList from "./WorkflowList.tsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");
const city = buildCityModel(loadProject(FIXTURE));
const layout = computeLayout(city.children, city.edges);

afterEach(cleanup);
const bodyRows = () => screen.getAllByRole("row").filter((r) => within(r).queryAllByRole("cell").length > 0);

describe("ZoneList (accessible non-3D fallback)", () => {
  it("renders one row per building at the level, including the state buildings", () => {
    render(<ZoneList layout={layout} matchedIds={null} selectedId={null} onSelect={() => {}} onEnter={() => {}} />);
    expect(screen.getByRole("region", { name: /buildings at this level/i })).toBeTruthy();
    expect(bodyRows().length).toBe(layout.buildings.length);
    expect(screen.getByText("Initialization", { exact: false })).toBeTruthy();
  });

  it("filters to the matched set", () => {
    const stateId = city.children.find((c) => c.kind === "state")!.id;
    render(<ZoneList layout={layout} matchedIds={new Set([stateId])} selectedId={null} onSelect={() => {}} onEnter={() => {}} />);
    expect(bodyRows().length).toBe(1);
  });

  it("selects on click/keyboard and offers an Enter action for enterable buildings", () => {
    const onSelect = vi.fn();
    const onEnter = vi.fn();
    const stateId = city.children.find((c) => c.kind === "state" && c.children.length > 0)!.id;
    render(<ZoneList layout={layout} matchedIds={new Set([stateId])} selectedId={null} onSelect={onSelect} onEnter={onEnter} />);
    const row = bodyRows()[0];
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(stateId);
    fireEvent.click(screen.getByText(/Enter/));
    expect(onEnter).toHaveBeenCalledWith(stateId);
  });
});
