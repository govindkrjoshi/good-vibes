import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin, type Rollup } from "vite";

const id = "virtual:sandbox-runtime";
const resolved = `\0${id}`;
const entry = fileURLToPath(new URL("./runtime.ts", import.meta.url));
const appDir = path.dirname(path.dirname(entry));

// The sandbox's opaque origin can't load scripts from this server, so its
// runtime is built to one script and handed to the page as text to inline.
export const sandboxRuntime = (): Plugin => ({
  name: "sandbox-runtime",
  resolveId: (source) => (source === id ? resolved : undefined),
  async load(loading) {
    if (loading !== resolved) return undefined;
    const result = await build({
      configFile: false,
      logLevel: "warn",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: {
        write: false,
        lib: { entry, formats: ["iife"], name: "sandboxRuntime" },
      },
    });
    const { output } = (
      Array.isArray(result) ? result[0] : result
    ) as Rollup.RollupOutput;
    const [chunk] = output;
    for (const module of Object.keys(chunk.modules)) {
      if (module.startsWith(appDir)) this.addWatchFile(module);
    }
    return `export default ${JSON.stringify(chunk.code)};`;
  },
});
