import type { Connection, Edge, XYPosition } from "@xyflow/react";
import {
  canPatch,
  isInside,
  type Jack,
  type ParamGroup,
  type Patch,
  type Rack,
} from "../rack";
import {
  treeHeaderHeight,
  treeInset,
  treeJackRowHeight,
  treeNodeHeight,
  treeNodeWidth,
  type CanvasNode,
  type TreeNodeData,
} from "./nodes";

const origin: XYPosition = { x: 0, y: 0 };

const subtract = (a: XYPosition, b: XYPosition): XYPosition => ({
  x: a.x - b.x,
  y: a.y - b.y,
});

// A tree's jack has a second socket facing the racks inside the tree. It is the
// same jack, so only React Flow sees this id.
const insidePrefix = "inside:";

export const insideHandleId = (jackId: string) => `${insidePrefix}${jackId}`;

const jackIdOf = (handleId: string) =>
  handleId.startsWith(insidePrefix)
    ? handleId.slice(insidePrefix.length)
    : handleId;

// The two jacks a React Flow connection or edge joins, when it names both.
export const jackIds = ({ sourceHandle, targetHandle }: Connection | Edge) =>
  sourceHandle == null || targetHandle == null
    ? undefined
    : ([jackIdOf(sourceHandle), jackIdOf(targetHandle)] as const);

const hasParams = (group: ParamGroup | undefined): boolean =>
  group !== undefined &&
  ((group.params?.length ?? 0) > 0 ||
    Object.values(group.groups ?? {}).some(hasParams));

// A block with anything to set or trigger is drawn as a panel of controls; one
// without is only a box to wire.
const hasControls = (block: Rack, paramGroups: Record<string, ParamGroup>) =>
  block.methodIds.length > 0 ||
  (block.paramGroupId !== undefined &&
    hasParams(paramGroups[block.paramGroupId]));

const nodeWidth = (node: CanvasNode) => node.width ?? node.measured?.width ?? 0;
const nodeHeight = (node: CanvasNode) =>
  node.height ?? node.measured?.height ?? 0;

// React Flow keeps a child's position relative to its parent.
const absolutePosition = (
  id: string | undefined,
  nodes: ReadonlyMap<string, CanvasNode>,
): XYPosition => {
  const node = id === undefined ? undefined : nodes.get(id);
  if (node === undefined) return origin;
  const parent = absolutePosition(node.parentId, nodes);
  return { x: node.position.x + parent.x, y: node.position.y + parent.y };
};

// A tree's jacks sit in a band under its header, as tall as its longer side.
const jacksHeight = ({ jacks }: TreeNodeData) => {
  const inputs = jacks.filter((jack) => jack.direction === "in").length;
  const rows = Math.max(inputs, jacks.length - inputs);
  return treeHeaderHeight + rows * treeJackRowHeight;
};

// Keeps each tree's children clear of its edges, header and jacks, and grows the tree
// around them and its jacks. A tree never shrinks by itself. Nodes come parents first, so
// walking them backwards fits a nested tree before the one holding it.
export const fitTrees = (nodes: readonly CanvasNode[]): CanvasNode[] => {
  const fitted = new Map(nodes.map((node) => [node.id, node]));

  for (const { id } of nodes.toReversed()) {
    const tree = fitted.get(id);
    if (tree?.type !== "tree") continue;

    let width = nodeWidth(tree);
    let height = Math.max(nodeHeight(tree), jacksHeight(tree.data));
    for (const { id: childId, parentId } of nodes) {
      const child = fitted.get(childId);
      if (parentId !== id || child === undefined) continue;

      const x = Math.max(child.position.x, treeInset);
      const y = Math.max(child.position.y, jacksHeight(tree.data));
      if (x !== child.position.x || y !== child.position.y) {
        fitted.set(childId, { ...child, position: { x, y } });
      }
      width = Math.max(width, x + nodeWidth(child) + treeInset);
      height = Math.max(height, y + nodeHeight(child) + treeInset);
    }
    if (width !== nodeWidth(tree) || height !== nodeHeight(tree)) {
      fitted.set(id, { ...tree, width, height });
    }
  }

  // Replacing a node keeps its place, so the map is still in the input's order.
  return [...fitted.values()];
};

// The innermost tree under a point that the dragged racks can go into: not one
// of them, and not inside one of them.
export const treeAt = (
  nodes: readonly CanvasNode[],
  point: XYPosition,
  racks: Readonly<Record<string, Rack>>,
  draggedIds: readonly string[],
): string | undefined => {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return nodes.findLast((node) => {
    if (
      node.type !== "tree" ||
      draggedIds.some((id) => id === node.id || isInside(racks, node.id, id))
    ) {
      return false;
    }
    const { x, y } = absolutePosition(node.id, byId);
    return (
      point.x >= x &&
      point.x <= x + nodeWidth(node) &&
      point.y >= y &&
      point.y <= y + nodeHeight(node)
    );
  })?.id;
};

export const syncNodesFromRack = (
  currentNodes: readonly CanvasNode[],
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  paramGroups: Record<string, ParamGroup>,
  rootId: string,
): CanvasNode[] => {
  const held = new Map(currentNodes.map((node) => [node.id, node]));

  // Parents go before their children, as React Flow requires.
  const nodesUnder = (treeId: string): CanvasNode[] => {
    const tree = blocks[treeId];
    if (tree === undefined || tree.type !== "tree") return [];

    const parentId = treeId === rootId ? undefined : treeId;

    return tree.children.flatMap((id): CanvasNode[] => {
      const block = blocks[id];
      if (block === undefined) return [];

      const blockJacks = block.jackIds.flatMap((jackId) => jacks[jackId] ?? []);
      const current = held.get(id);
      const base = current ?? { id: block.id, position: origin };
      // A rack changing parents stays where it is on the canvas.
      const position =
        current === undefined || current.parentId === parentId
          ? base.position
          : subtract(
              absolutePosition(id, held),
              absolutePosition(parentId, held),
            );
      const placed = { ...base, position, parentId };

      if (block.type === "tree") {
        return [
          {
            width: treeNodeWidth,
            height: treeNodeHeight,
            // Behind other racks, so a new tree doesn't cover them.
            zIndex: -1,
            ...placed,
            type: "tree",
            data: {
              name: block.name,
              jacks: blockJacks,
              childCount: block.children.length,
            },
          },
          ...nodesUnder(id),
        ];
      }

      return [
        hasControls(block, paramGroups)
          ? {
              ...placed,
              type: "rack",
              data: { blockId: block.id, name: block.name, jacks: blockJacks },
            }
          : {
              ...placed,
              type: "block",
              data: { name: block.name, jacks: blockJacks },
            },
      ];
    });
  };

  return fitTrees(nodesUnder(rootId));
};

export const toFlowEdges = (
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  patches: Record<string, Patch>,
  rootId: string,
): Edge[] => {
  const edgesUnder = (treeId: string): Edge[] => {
    const tree = blocks[treeId];
    if (tree === undefined || tree.type !== "tree") return [];

    const edges = tree.patches.flatMap((id) => {
      const patch = patches[id];
      if (patch === undefined) return [];

      const source = jacks[patch.from];
      const target = jacks[patch.to];

      if (
        source === undefined ||
        target === undefined ||
        !canPatch(blocks, source, target)
      ) {
        return [];
      }

      // Signal only leaves an input, or arrives at an output, inside a tree.
      return [
        {
          id: patch.id,
          source: source.belongToBlockId,
          sourceHandle:
            source.direction === "in" ? insideHandleId(source.id) : source.id,
          target: target.belongToBlockId,
          targetHandle:
            target.direction === "out" ? insideHandleId(target.id) : target.id,
        },
      ];
    });

    return [...edges, ...tree.children.flatMap(edgesUnder)];
  };

  return edgesUnder(rootId);
};
