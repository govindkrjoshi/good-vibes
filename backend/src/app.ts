import { Hono } from "hono";

export const app = new Hono();

app.get("/api/v1/heath", (c) => c.json({ status: "ok" }));
