import { setTimeout as delay } from "node:timers/promises";

export function matchingActiveSprintName(
  sprintField: unknown,
  sprintPattern: RegExp,
): string {
  if (!Array.isArray(sprintField)) return "";

  for (const value of sprintField) {
    if (!value || typeof value !== "object") continue;
    const sprint = value as { state?: string; name?: string };
    if (
      sprint.state === "active" &&
      sprint.name &&
      sprintPattern.test(sprint.name)
    ) {
      return sprint.name;
    }
  }
  return "";
}

export function githubRateLimitRetryDelayMs(
  status: number,
  headers: Pick<Headers, "get">,
  body: string,
  nowMs = Date.now(),
): number | undefined {
  const retryAfter = headers.get("retry-after");
  const remaining = headers.get("x-ratelimit-remaining");
  const isRateLimited =
    status === 429 ||
    (status === 403 &&
      (remaining === "0" || Boolean(retryAfter) || /rate limit/i.test(body)));
  if (!isRateLimited) return undefined;

  let delayMs = 60_000;
  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      delayMs = Math.max(delayMs, retryAfterSeconds * 1000);
    } else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) {
        delayMs = Math.max(delayMs, retryAt - nowMs + 1000);
      }
    }
  }

  if (remaining === "0") {
    const resetAt = Number(headers.get("x-ratelimit-reset"));
    if (Number.isFinite(resetAt) && resetAt > 0) {
      delayMs = Math.max(delayMs, resetAt * 1000 - nowMs + 1000);
    }
  }

  return delayMs;
}

// The collector calls this sequentially; share pacing across all engineers.
export function createGithubRequest(token: string) {
  let nextRequestAt = 0;
  const maxRetries = 3;

  return async function githubRequest(
    url: string,
  ): Promise<Record<string, unknown>> {
    let backoffMs = 60_000;
    for (let attempt = 0; ; attempt++) {
      const pacingMs = nextRequestAt - Date.now();
      if (pacingMs > 0) {
        await delay(pacingMs);
      }
      nextRequestAt = Date.now() + 2100;
      const response = await fetch(url, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }

      const body = await response.text();
      const retryDelayMs = githubRateLimitRetryDelayMs(
        response.status,
        response.headers,
        body,
      );
      if (retryDelayMs === undefined || attempt >= maxRetries) {
        throw new Error(
          `GitHub error ${response.status} for ${url}: ${body.slice(0, 500)}`,
        );
      }

      const delayMs = Math.max(retryDelayMs, backoffMs);
      console.warn(
        `  GitHub rate limit (HTTP ${response.status}): waiting ${Math.ceil(delayMs / 1000)}s before retry ${attempt + 1}/${maxRetries}`,
      );
      await delay(delayMs);
      backoffMs = delayMs * 2;
    }
  };
}
