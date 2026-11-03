import { defineItem, input } from "../../../kit";

// The speakers. Anything patched into it is sent to Tone's destination.
export default defineItem("outputs", "Destination", {
  description: "The speakers: anything patched into it is heard.",
  code: `Effect.gen(function* () {
  const { tone } = yield* RenderContext;
  return tone.getDestination();
})`,
  jacks: [input()],
});
