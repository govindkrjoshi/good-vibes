import * as webAudio from "web-audio-api";
import type * as ToneJs from "tone";

// Tone checks nodes against the browser's audio classes, so Node gets
// web-audio-api's in their place before Tone loads. For tests only.
export const loadRealTone = async (): Promise<typeof ToneJs> => {
  const globals = globalThis as Record<string, unknown>;
  for (const [name, value] of Object.entries(webAudio)) globals[name] ??= value;
  globals.window ??= globalThis;
  const tone = await import("tone");
  tone.setContext(
    new webAudio.OfflineAudioContext(
      2,
      44100,
      44100,
    ) as unknown as OfflineAudioContext,
  );
  return tone;
};

export { webAudio };
