import { useReducer } from "react";
import { type Rack, emptyRack } from "~/types/rack";

type RackState = {
  rack: Rack;
};

const initialState = {
  rack: emptyRack,
};

export const useRack = (init: RackState = initialState) => {
  const reducer = (state: RackState, _action: any) => {
    return state;
  };
  const [state, dispatch] = useReducer(reducer, init);

  return { state, dispatch };
};
