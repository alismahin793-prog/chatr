import { describe, it, expect } from "vitest";
import { isAuthorized } from "../src/auth";

describe("isAuthorized", () => {
  it("accepts the exact Bearer token", () => {
    expect(isAuthorized("Bearer supersecret", "supersecret")).toBe(true);
  });

  it("rejects missing, empty, and malformed headers", () => {
    expect(isAuthorized(undefined, "supersecret")).toBe(false);
    expect(isAuthorized("", "supersecret")).toBe(false);
    expect(isAuthorized("supersecret", "supersecret")).toBe(false);
    expect(isAuthorized("Basic dXNlcjpwYXNz", "supersecret")).toBe(false);
    expect(isAuthorized("Bearer ", "supersecret")).toBe(false);
  });

  it("rejects wrong tokens", () => {
    expect(isAuthorized("Bearer nope", "supersecret")).toBe(false);
    expect(isAuthorized("Bearer supersecretX", "supersecret")).toBe(false);
    expect(isAuthorized("Bearer xsupersecret", "supersecret")).toBe(false);
  });

  it("accepts scheme case-insensitively", () => {
    expect(isAuthorized("bearer supersecret", "supersecret")).toBe(true);
  });

  it("rejects when the expected token is empty", () => {
    expect(isAuthorized("Bearer x", "")).toBe(false);
  });
});