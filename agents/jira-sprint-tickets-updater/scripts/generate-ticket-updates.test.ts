import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("generate-ticket-updates", () => {
  describe("config loading", () => {
    it("loads a valid config file with project-based structure", () => {
      const configPath = resolve(import.meta.dirname, "../data/config.json");
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as {
        jira: { cloud_id: string; board_id: number };
        projects: Record<
          string,
          {
            workflows: Record<
              string,
              { issue_types: string[]; transition_rules: unknown[] }
            >;
          }
        >;
      };
      expect(config.jira.cloud_id).toBe("redhat.atlassian.net");
      expect(config.jira.board_id).toBeGreaterThan(0);
      expect(Object.keys(config.projects).length).toBeGreaterThan(0);
    });

    it("has at least one workflow per project", () => {
      const configPath = resolve(import.meta.dirname, "../data/config.json");
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as {
        projects: Record<
          string,
          {
            workflows: Record<
              string,
              { issue_types: string[]; transition_rules: unknown[] }
            >;
          }
        >;
      };
      for (const [key, project] of Object.entries(config.projects)) {
        const workflows = Object.keys(project.workflows);
        expect(workflows.length, `${key} has no workflows`).toBeGreaterThan(0);
      }
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
});
