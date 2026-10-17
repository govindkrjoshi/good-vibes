import { Effect } from "effect";
import { RenderContext, type ParamGroup, type Jack } from "../../rack/model";
import { byId, inputJack, type CatalogueItem } from "../common";

const name: string = "Destination";
const category: string = "output";
const type = "leaf";
const id: string = `catalogue:${category}:${name}`;

// The speakers. Anything patched into it is sent to Tone's destination.
const paramGroup: ParamGroup = { id: `${id}:paramGroup` };
const jacks: Jack[] = [inputJack(id)];

export const item: CatalogueItem = {
  name,
  category,
  rack: {
    id,
    name,
    type,
    paramGroupId: paramGroup.id,
    jackIds: jacks.map((i) => i.id),
    eventIds: [],
    methodIds: [],
    isRoot: false,
    code: Effect.gen(function* () {
      const { tone } = yield* RenderContext;
      return tone.getDestination();
    }),
  },
  paramGroup,
  methods: {},
  events: {},
  jacks: byId(jacks),
};
