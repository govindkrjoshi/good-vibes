import type { Edge, Node, XYPosition } from "@xyflow/react";
import { canPatch, type Jack, type Patch, type Rack } from "~/types/rack";

/** The size a block renders at, used to centre new ones under the viewport. */
export const blockSize = { width: 176, height: 44 };

/** The size React Flow measured a block at on the canvas. */
export type BlockDimensions = {
  readonly width: number;
  readonly height: number;
};

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
  dimensions: Record<string, BlockDimensions>,
  selectedIds: readonly string[],
): BlockNode[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  return root.children.flatMap((id) => {
    const block = blocks[id];
    if (block === undefined) return [];

    // React Flow rebuilds a controlled node's `measured` from the node handed
    // to it, so a block it has already measured needs that size folded back in
    // or it counts as uninitialised and will not drag. `measured` only: `width`
    // and `height` are the author's own sizes and land as inline styles, which
    // would pin the block at its first measurement instead of letting it grow
    // with its content.
    const measured = dimensions[block.id];

    return [
      {
        id: block.id,
        type: "block" as const,
        position: positions[block.id] ?? origin,
        ...(measured === undefined ? {} : { measured }),
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

/** The rack's patches as React Flow edges between block jack handles. */
export const toFlowEdges = (
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  patches: Record<string, Patch>,
  rootId: string,
): Edge[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  return root.patches.flatMap((id) => {
    const patch = patches[id];
    if (patch === undefined) return [];

    const source = jacks[patch.from];
    const target = jacks[patch.to];

    // The store patches by this same rule, so a patch that fails it is one the
    // canvas cannot draw rather than one it would draw the wrong way round.
    if (
      source === undefined ||
      target === undefined ||
      !canPatch(root, source, target)
    ) {
      return [];
    }

    return [
      {
        id: patch.id,
        source: source.belongToBlockId,
        sourceHandle: source.id,
        target: target.belongToBlockId,
        targetHandle: target.id,
      },
    ];
  });
};
