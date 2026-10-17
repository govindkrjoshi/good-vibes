import { Effect } from "effect";
import { RenderContext, type ParamGroup, type Jack } from "../../rack/model";
import { byId, inputJack, outputJack, type CatalogueItem } from "../common";

const name: string = "AMOscillator";
const category: string = "source";
const type = "leaf";
const id: string = `catalogue:${category}:${name}`;

const paramGroup: ParamGroup = { id: `${id}:paramGroup` };
const jacks: Jack[] = [inputJack(id), outputJack(id)];

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
    // An oscillator makes no sound until started, and has no trigger
    // method to start it later, so it runs from the moment it is built.
    code: Effect.gen(function* () {
      const { tone } = yield* RenderContext;
      return new tone.AMOscillator().start();
    }),
  },
  paramGroup,
  methods: {},
  events: {},
  jacks: byId(jacks),
};
