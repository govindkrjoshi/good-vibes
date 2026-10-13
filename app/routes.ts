import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("pages/home/home.tsx"),
  route("sandbox.html", "pages/sandbox/sandbox.ts"),
] satisfies RouteConfig;
