import type { Node } from "@xyflow/react";
import type { Jack } from "../rack";

// A block with nothing to set or trigger: a box with jacks to wire.
export type BlockNodeData = {
  readonly name: string;
  readonly kind: "leaf" | "tree";
  readonly jacks: readonly Jack[];
};

export type BlockNodeType = Node<BlockNodeData, "block">;

// A block with params or methods: a panel of its controls.
export type RackNodeData = {
  readonly blockId: string;
  readonly name: string;
  readonly jacks: readonly Jack[];
};

export type RackNodeType = Node<RackNodeData, "rack">;

export type CanvasNode = BlockNodeType | RackNodeType;

export const rackNodeWidth = 360;
