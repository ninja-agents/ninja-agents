import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("build-reference", () => {
  describe("config loading", () => {
    it("loads a valid config file", () => {
      const configPath = resolve(
        import.meta.dirname,
        "../data/config.example.json",
      );
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      expect(config).toBeDefined();
      expect(config).toHaveProperty("jira");
      expect(config).toHaveProperty("sizing_guide");
      expect(config).toHaveProperty("estimation");
    });

    it("has required jira fields", () => {
      const configPath = resolve(
        import.meta.dirname,
        "../data/config.example.json",
      );
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as {
        jira: Record<string, unknown>;
      };
      expect(config.jira).toHaveProperty("story_points_field");
      expect(config.jira).toHaveProperty("reference_jql");
      expect(config.jira).toHaveProperty("backlog_jql");
      expect(config.jira).toHaveProperty("max_reference_tickets");
    });

    it("has all fibonacci SP values in sizing guide", () => {
      const configPath = resolve(
        import.meta.dirname,
        "../data/config.example.json",
      );
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as {
        sizing_guide: Record<string, unknown>;
      };
      for (const sp of ["2", "5", "8", "13", "21"]) {
        expect(config.sizing_guide).toHaveProperty(sp);
      }
    });
  });
});
