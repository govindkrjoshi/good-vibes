import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sandbox.html", "routes/sandbox.ts"),
] satisfies RouteConfig;
