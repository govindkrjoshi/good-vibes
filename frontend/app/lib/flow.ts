import type { Node, XYPosition } from "@xyflow/react";
import type { Jack, Rack } from "~/types/rack";

/** The size a block renders at, used to centre new ones under the viewport. */
export const blockSize = { width: 176, height: 44 };

export type BlockNodeData = {
  readonly name: string;
  readonly kind: "node" | "tree";
  /** The block's jacks, resolved from their ids: one handle each. */
  readonly jacks: readonly Jack[];
};

export type BlockNode = Node<BlockNodeData, "block">;

const origin: XYPosition = { x: 0, y: 0 };

/**
 * The rack as React Flow sees it: the rack says what the blocks are, the
 * canvas says where they sit. Only the root's children are on the canvas — a
 * group's own children live inside it, and opening one is its own step.
 */
export const toFlowNodes = (
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  rootId: string,
  positions: Record<string, XYPosition>,
  selectedIds: readonly string[],
): BlockNode[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  return root.children.flatMap((id) => {
    const block = blocks[id];
    if (block === undefined) return [];

    return [
      {
        id: block.id,
        type: "block" as const,
        position: positions[block.id] ?? origin,
        selected: selectedIds.includes(block.id),
        data: {
          name: block.name,
          kind: block.type === "tree" ? "tree" : "node",
          jacks: block.jackIds.flatMap((jackId) => jacks[jackId] ?? []),
        },
      },
    ];
  });
};
