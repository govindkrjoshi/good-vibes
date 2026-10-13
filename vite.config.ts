import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => ({
  plugins: [tailwindcss(), reactRouter()],
  define: {
    // The dev server hands its OpenRouter key (from the shell or a .env file)
    // to the browser for testing. Builds never embed one; users enter their
    // own. See app/agent-key.ts.
    __DEV_OPENROUTER_API_KEY__: JSON.stringify(
      command === "serve"
        ? (loadEnv(mode, process.cwd(), "OPENROUTER_").OPENROUTER_API_KEY ?? "")
        : "",
    ),
  },
  // Pre-bundle these at startup instead of letting Vite discover them on the
  // first page load. Late discovery triggers a second optimize pass, which
  // bumps the dep `?v=` hash and 504s any module URL the browser already
  // holds ("Outdated Optimize Dep"). It also reloads the page mid-test,
  // which made the e2e suite flaky on a cold cache.
  optimizeDeps: {
    include: [
      "@base-ui/react/avatar",
      "@base-ui/react/button",
      "@base-ui/react/collapsible",
      "@base-ui/react/input",
      "@base-ui/react/menu",
      "@base-ui/react/merge-props",
      "@base-ui/react/popover",
      "@base-ui/react/select",
      "@base-ui/react/separator",
      "@base-ui/react/slider",
      "@base-ui/react/switch",
      "@base-ui/react/toggle",
      "@base-ui/react/toggle-group",
      "@base-ui/react/toolbar",
      "@base-ui/react/tooltip",
      "@base-ui/react/use-render",
      "@dagrejs/dagre",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-ai/providers/openrouter",
      "@shadcn/react/message-scroller",
      "@xyflow/react",
      "class-variance-authority",
      "cn",
      "effect",
      "lucide-react",
      "tone",
      "zustand",
      "zustand/react/shallow",
    ],
  },
}));
