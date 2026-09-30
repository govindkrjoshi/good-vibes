import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  optimizeDeps: {
    // Pre-bundle these at startup instead of letting Vite discover them on the
    // first page load. Late discovery triggers a second optimize pass, which
    // bumps the dep `?v=` hash and 504s any module URL the browser already
    // holds ("Outdated Optimize Dep"). It also reloads the page mid-test,
    // which made the e2e suite flaky on a cold cache.
    include: [
      "@base-ui/react/button",
      "@base-ui/react/menu",
      "@base-ui/react/popover",
      "@base-ui/react/toolbar",
      "@base-ui/react/tooltip",
      "@xyflow/react",
      "class-variance-authority",
      "cn",
      "effect",
      "lucide-react",
      "zustand",
    ],
  },
});
