import { fileURLToPath } from "node:url";
import { build, type Plugin, type Rolldown } from "vite";

// The sandbox frame has an opaque origin and a CSP that loads nothing, so its
// script cannot be a module the dev server or a CDN hands out. Instead this
// bundles app/sandbox/frame.ts, with Tone.js and everything else it imports,
// into one classic script, and `virtual:sandbox-frame` exports its source for
// the sandbox page to inline.
const id = "virtual:sandbox-frame";
const resolvedId = `\0${id}`;
const entry = fileURLToPath(new URL("./app/sandbox/frame.ts", import.meta.url));

export const sandboxBundle = (): Plugin => ({
  name: "good-vibes:sandbox-bundle",
  resolveId: (source) => (source === id ? resolvedId : undefined),
  async load(source) {
    if (source !== resolvedId) return undefined;

    const result = (await build({
      configFile: false,
      logLevel: "warn",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: {
        write: false,
        minify: true,
        // Inlined into the page, so there is nothing to map back to.
        sourcemap: false,
        lib: {
          entry,
          formats: ["iife"],
          name: "goodVibesSandbox",
          fileName: () => "frame.js",
        },
      },
    })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];

    const [chunk] = (Array.isArray(result) ? result : [result]).flatMap(
      (output) => output.output.filter((file) => file.type === "chunk"),
    );
    if (chunk === undefined) throw new Error("Sandbox frame did not bundle");

    // Rebuilt in dev whenever a file it was bundled from changes.
    for (const moduleId of chunk.moduleIds) {
      if (!moduleId.startsWith("\0")) this.addWatchFile(moduleId);
    }

    // `</script` would end the inline script early.
    const code = chunk.code.replaceAll("</script", "<\\/script");
    return `export default ${JSON.stringify(code)};`;
  },
});
