import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("GET /api/v1/heath", () => {
  it("returns a healthy status", async () => {
    const response = await app.request("/api/v1/heath");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
