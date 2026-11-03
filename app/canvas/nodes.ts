import type { Node } from "@xyflow/react";
import type { Jack } from "../rack";

// A block with nothing to set or trigger: a box with jacks to wire.
export type BlockNodeData = {
  readonly name: string;
  readonly jacks: readonly Jack[];
};

export type BlockNodeType = Node<BlockNodeData, "block">;

// A block with params or methods: a panel of its controls.
export type RackNodeData = {
  readonly name: string;
  readonly jacks: readonly Jack[];
};

export type RackNodeType = Node<RackNodeData, "rack">;

// A tree rack: an open frame that other racks sit inside.
export type TreeNodeData = {
  readonly name: string;
  readonly jacks: readonly Jack[];
  readonly childCount: number;
};

export type TreeNodeType = Node<TreeNodeData, "tree">;

export type CanvasNode = BlockNodeType | RackNodeType | TreeNodeType;

export const rackNodeWidth = 360;
export const treeNodeWidth = 420;
export const treeNodeHeight = 280;
// The room a tree keeps around its children, below its header and jacks.
export const treeInset = 24;
export const treeHeaderHeight = 56;
export const treeJackRowHeight = 28;
