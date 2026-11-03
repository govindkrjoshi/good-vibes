// @vitest-environment happy-dom

import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { initialCanvasState, useCanvasStore } from "./canvas-store";
import { TreeNode } from "./tree-node";
import type { TreeNodeType } from "../../canvas";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

const render = (childCount: number) => {
  const container = document.createElement("div");
  const props = {
    id: "t",
    data: { name: "Group", jacks: [], childCount },
  } as unknown as NodeProps<TreeNodeType>;
  root = createRoot(container);
  act(() =>
    root?.render(
      <ReactFlowProvider>
        <TreeNode {...props} />
      </ReactFlowProvider>,
    ),
  );
  return container;
};

afterEach(() => {
  act(() => root?.unmount());
  useCanvasStore.setState(initialCanvasState);
});

test("invites racks in while it is empty", () => {
  const { textContent } = render(0);

  expect(textContent).toContain("Drag a rack here");
  expect(textContent).not.toContain("0 racks");
});

test("counts the racks it holds in place of the invitation", () => {
  expect(render(1).textContent).toContain("1 rack");
  expect(render(2).textContent).toContain("2 racks");
  expect(render(2).textContent).not.toContain("Drag a rack here");
});

test("says what a drop will do while it is the drop target", () => {
  useCanvasStore.setState({ dropTargetId: "t" });

  const container = render(0);

  expect(container.textContent).toContain("Drop to add to Group");
  expect(container.querySelector("[data-drop-target]")).not.toBeNull();
});

test("stays quiet while another tree is the drop target", () => {
  useCanvasStore.setState({ dropTargetId: "other" });

  expect(render(0).querySelector("[data-drop-target]")).toBeNull();
});

test("offers to add jacks until the canvas is locked", () => {
  const open = render(0);
  expect(
    open.querySelector('[aria-label="Add input to Group"]'),
  ).not.toBeNull();
  expect(
    open.querySelector('[aria-label="Add output to Group"]'),
  ).not.toBeNull();

  useCanvasStore.setState({ locked: true });

  const locked = render(0);
  expect(locked.querySelector('[aria-label="Add input to Group"]')).toBeNull();
});
