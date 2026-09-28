import { useReducer } from "react";
import { type Rack, emptyRack } from "~/types/rack";

type RackState = {
  rack: Rack;
};

export type RackAction =
  { type: "addBlock"; blockType: "node" | "tree" } | { type: "run" };

const initialState = {
  rack: emptyRack,
};

export const useRack = (init: RackState = initialState) => {
  // Actions are typed but not yet handled: the toolbar dispatches them so the
  // wiring is in place, and each lands here as the rack operations are built.
  const reducer = (state: RackState, _action: RackAction) => {
    return state;
  };
  const [state, dispatch] = useReducer(reducer, init);

  return { state, dispatch };
};
