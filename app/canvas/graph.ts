import type { Connection, Edge, XYPosition } from "@xyflow/react";
import { canPatch, type Jack, type Patch, type Rack } from "../rack";
import type { CanvasNode } from "./nodes";

const origin: XYPosition = { x: 0, y: 0 };

// The two jacks a React Flow connection or edge joins, when it names both.
export const jackIds = (connection: Connection | Edge) =>
  connection.sourceHandle === null ||
  connection.sourceHandle === undefined ||
  connection.targetHandle === null ||
  connection.targetHandle === undefined
    ? undefined
    : ([connection.sourceHandle, connection.targetHandle] as const);

export const sameBlocks = (
  a: readonly CanvasNode[],
  b: readonly CanvasNode[],
) => a.length === b.length && a.every((node, i) => node.id === b[i]?.id);

// A block with anything to set or trigger is drawn as a panel of controls; one
// without is only a box to wire.
const hasControls = (block: Rack) =>
  block.methodIds.length > 0 ||
  block.paramIds.paramIds !== undefined ||
  block.paramIds.groups !== undefined;

export const syncNodesFromRack = (
  currentNodes: readonly CanvasNode[],
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  rootId: string,
): CanvasNode[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  const held = new Map(currentNodes.map((node) => [node.id, node]));

  return root.children.flatMap((id): CanvasNode[] => {
    const block = blocks[id];
    if (block === undefined) return [];

    const blockJacks = block.jackIds.flatMap((jackId) => jacks[jackId] ?? []);
    const base = held.get(id) ?? { id: block.id, position: origin };

    return [
      hasControls(block)
        ? {
            ...base,
            type: "rack",
            data: { blockId: block.id, name: block.name, jacks: blockJacks },
          }
        : {
            ...base,
            type: "block",
            data: { name: block.name, kind: block.type, jacks: blockJacks },
          },
    ];
  });
};

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
