import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubRequest } from "../collector-helpers.js";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));

const URL = "https://api.github.com/search/issues?q=author:example+is:pr";
const START = Date.parse("2026-10-21T16:00:00Z");

describe("GitHub collector requests", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
    vi.mocked(delay).mockImplementation((ms = 1) => {
      vi.setSystemTime(Date.now() + ms);
      return Promise.resolve();
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("recovers from secondary throttling even when primary quota remains", async () => {
    const requestedAt: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        requestedAt.push(Date.now() - START);
        return Promise.resolve(
          requestedAt.length === 1
            ? Response.json(
                { message: "You have exceeded a secondary rate limit." },
                { status: 403, headers: { "x-ratelimit-remaining": "13" } },
              )
            : Response.json({ items: [{ number: 42 }] }),
        );
      }),
    );

    const result = await createGithubRequest("test-token")(URL);

    expect(result.items).toEqual([{ number: 42 }]);
    expect(requestedAt).toEqual([0, 60_000]);
  });

  it("paces searches across engineers without adding response time to the interval", async () => {
    const requestedAt: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        requestedAt.push(Date.now() - START);
        vi.setSystemTime(Date.now() + 250);
        return Promise.resolve(Response.json({ items: [] }));
      }),
    );
    const request = createGithubRequest("test-token");

    await request(`${URL}+author:first`);
    await request(`${URL}+author:second`);
    await request(`${URL}+author:third`);

    expect(requestedAt).toEqual([0, 2100, 4200]);
  });

  it.each([
    ["Retry-After seconds", 403, { "retry-after": "90" }, 90_000],
    [
      "Retry-After HTTP date",
      403,
      { "retry-after": new Date(START + 90_000).toUTCString() },
      91_000,
    ],
    [
      "primary quota reset",
      403,
      {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(START / 1000 + 120),
      },
      121_000,
    ],
    [
      "later reset when Retry-After is shorter",
      429,
      {
        "retry-after": "90",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(START / 1000 + 120),
      },
      121_000,
    ],
    ["malformed cooldown headers", 429, { "retry-after": "invalid" }, 60_000],
    ["headerless HTTP 429", 429, {}, 60_000],
  ] as const)(
    "honors %s before retrying",
    async (_name, status, headers, waitMs) => {
      const requestedAt: number[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          requestedAt.push(Date.now() - START);
          return Promise.resolve(
            requestedAt.length === 1
              ? new Response("Throttled", { status, headers })
              : Response.json({ items: [] }),
          );
        }),
      );

      await createGithubRequest("test-token")(URL);

      expect(requestedAt).toEqual([0, waitMs]);
    },
  );

  it("stops after three exponentially delayed retries instead of returning empty activity", async () => {
    const requestedAt: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        requestedAt.push(Date.now() - START);
        return Promise.resolve(
          Response.json(
            { message: "You have exceeded a secondary rate limit." },
            { status: 403 },
          ),
        );
      }),
    );

    await expect(createGithubRequest("test-token")(URL)).rejects.toThrow(
      /GitHub error 403.*secondary rate limit/,
    );
    expect(requestedAt).toEqual([0, 60_000, 180_000, 420_000]);
  });

  it.each([401, 403, 500])(
    "fails immediately on non-throttling HTTP %s",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            Response.json({ message: "Access denied" }, { status }),
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(createGithubRequest("test-token")(URL)).rejects.toThrow(
        `GitHub error ${status} for ${URL}:`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Date.now()).toBe(START);
    },
  );

  it("propagates transport errors rather than reporting an empty search", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Connection reset"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGithubRequest("test-token")(URL)).rejects.toThrow(
      "Connection reset",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
