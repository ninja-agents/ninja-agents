import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

function runScript(csvContent: string, sprint = "Test"): string {
  const cacheDir = resolve(import.meta.dirname, "../data/cache");
  const outputPath = resolve(
    import.meta.dirname,
    "../data/output/test-output.md",
  );
  const configPath = resolve(import.meta.dirname, "../data/config.json");
  const csvPath = resolve(cacheDir, "jira-tickets.csv");
  writeFileSync(csvPath, csvContent);
  execFileSync(
    "npx",
    [
      "tsx",
      resolve(import.meta.dirname, "generate-ticket-updates.ts"),
      "--config",
      configPath,
      "--cache",
      cacheDir,
      "--output",
      outputPath,
      "--sprint",
      sprint,
    ],
    { encoding: "utf-8" },
  );
  return readFileSync(outputPath, "utf-8");
}

describe("generate-ticket-updates", () => {
  describe("config loading", () => {
    it("loads a valid config file with project-based structure", () => {
      const configPath = resolve(import.meta.dirname, "../data/config.json");
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as {
        jira: { cloud_id: string; board_id: number };
        projects: Record<string, unknown>;
      };
      expect(config.jira.cloud_id).toBe("redhat.atlassian.net");
      expect(config.jira.board_id).toBeGreaterThan(0);
      expect(Object.keys(config.projects).length).toBeGreaterThan(0);
    });

    it("every transition rule has required fields", () => {
      const configPath = resolve(import.meta.dirname, "../data/config.json");
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as {
        projects: Record<
          string,
          {
            workflows: Record<
              string,
              {
                transition_rules: {
                  from: string;
                  to: string;
                  condition: string;
                  transition_id: string;
                }[];
              }
            >;
          }
        >;
      };
      for (const [pKey, project] of Object.entries(config.projects)) {
        for (const [wKey, workflow] of Object.entries(project.workflows)) {
          for (const rule of workflow.transition_rules) {
            const ctx = `${pKey}.${wKey}`;
            expect(rule.from, `${ctx}: missing from`).toBeTruthy();
            expect(rule.to, `${ctx}: missing to`).toBeTruthy();
            expect(rule.condition, `${ctx}: missing condition`).toBeTruthy();
            expect(rule.transition_id, `${ctx}: missing id`).toBeTruthy();
          }
        }
      }
    });
  });

  describe("transition logic", () => {
    it("proposes transition for merged PR", () => {
      const csv = `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states
CNV-1,Test story,In Progress,Alice,Story,Major,,https://github.com/org/repo/pull/1,merged`;
      const output = runScript(csv);
      expect(output).toContain("CNV-1");
      expect(output).toContain("Dev Complete");
      expect(output).toContain("**1** to transition");
    });

    it("skips ticket with open PR", () => {
      const csv = `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states
CNV-1,Test story,In Progress,,Story,Major,,https://github.com/org/repo/pull/1,open`;
      const output = runScript(csv);
      expect(output).toContain("condition not met");
      expect(output).toContain("**0** to transition");
    });

    it("handles mixed resolved/open links correctly", () => {
      const csv = `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states
CNV-1,Mixed links,In Progress,,Story,Major,,https://github.com/org/repo/pull/1;https://github.com/org/repo/pull/2,merged;open`;
      const output = runScript(csv);
      expect(output).toContain("condition not met");
    });

    it("catches URL/state count mismatch", () => {
      const csv = `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states
CNV-1,Mismatched,In Progress,,Story,Major,,https://github.com/org/repo/pull/1;https://github.com/org/repo/pull/2,merged`;
      const output = runScript(csv);
      expect(output).toContain("GitHub state data incomplete");
    });

    it("handles OCPBUGS bugzilla workflow", () => {
      const csv = `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states
OCPBUGS-1,Bug POST,POST,,Bug,Major,,https://github.com/org/repo/pull/1,merged`;
      const output = runScript(csv);
      expect(output).toContain("MODIFIED");
    });

    it("treats closed GitHub issue as resolved", () => {
      const csv = `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states
OCPBUGS-1,Bug with issue,POST,,Bug,Major,,https://github.com/org/repo/issues/1,closed`;
      const output = runScript(csv);
      expect(output).toContain("MODIFIED");
    });

    it("blocks transitions from protected statuses", () => {
      const csv = `key,summary,status,assignee,issuetype,priority,resolution,github_urls,github_states
CNV-1,Already in Dev Complete,Dev Complete,,Story,Major,,https://github.com/org/repo/pull/1,merged
OCPBUGS-1,Already MODIFIED,MODIFIED,,Bug,Major,,https://github.com/org/repo/pull/2,open`;
      const output = runScript(csv);
      expect(output).toContain("protected status");
      expect(output).toContain("**0** to transition");
    });
  });
});
