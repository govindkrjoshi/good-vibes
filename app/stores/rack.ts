import { castDraft } from "immer";

import type { SliceCreator } from "./common";
import {
  rootRack,
  type Rack,
  type Jack,
  type Param,
  type Method,
  type ParamValue,
  type AutomationEvent,
  type Patch,
  type RackEvent,
  type Transport,
} from "../rack/model";

type State = {
  readonly racks: Record<string, Rack>;
  readonly jacks: Record<string, Jack>;
  readonly params: Record<string, Param>;
  readonly methods: Record<string, Method>;
  readonly values: Record<string, ParamValue>;
  readonly automations: Record<string, readonly AutomationEvent[]>;
  readonly patches: Record<string, Patch>;
  readonly events: Record<string, RackEvent>;
  readonly transport: Transport;
  readonly rootId: string;
};

type Actions = {
  readonly addRack: (rack: Rack) => void;
  readonly reset: () => void;
};

export type RackSlice = State & Actions;

const initialState: State = {
  racks: { [rootRack.id]: rootRack },
  jacks: {},
  params: {},
  methods: {},
  values: {},
  automations: {},
  patches: {},
  events: {},
  transport: { bpm: 120 },
  rootId: "root",
};

export const createRackSlice: SliceCreator<RackSlice> = (set) => ({
  ...initialState,
  reset: () =>
    set(
      (state) => {
        Object.assign(state.rack, initialState);
      },
      undefined,
      "rack/reset",
    ),
  addRack: (rack) =>
    set(
      (state) => {
        state.rack.racks[rack.id] = castDraft(rack);
      },
      undefined,
      "rack/addRack",
    ),
});
