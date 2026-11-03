import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "./tool";

// How the agent tells the user what it is about to do. The chat shows the
// sentence as the heading of the changes that follow; the model's own
// reasoning is never shown, so this is its one way to narrate as it works.
export const briefTool = () =>
  defineTool({
    name: "brief",
    label: "Saying what's next",
    description:
      "Tells the user, in one short sentence, what you are about to do to the rack. Call it before a change or a run of changes, in the same reply as them. It changes nothing itself.",
    parameters: Type.Object({
      text: Type.String({
        description:
          "One plain sentence in your own voice, such as: I'll add a MonoSynth and patch it into the speakers.",
      }),
    }),
    run: ({ text }) => `Told the user: ${text}`,
  });
