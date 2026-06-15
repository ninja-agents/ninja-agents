import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("generate-report", () => {
  describe("config loading", () => {
    it("loads a valid config file", () => {
      const configPath = resolve(
        import.meta.dirname,
        "../data/config.example.json",
      );
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      expect(config).toBeDefined();
      expect(config.channels).toBeDefined();
      expect(config.keywords).toBeDefined();
      expect(Array.isArray(config.channels)).toBe(true);
    });

    it("has at least one channel configured", () => {
      const configPath = resolve(
        import.meta.dirname,
        "../data/config.example.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
        channels: { id: string; name: string }[];
      };
      expect(config.channels.length).toBeGreaterThan(0);
      expect(config.channels[0].id).toBeTruthy();
      expect(config.channels[0].name).toBeTruthy();
    });

    it("has at least one keyword category", () => {
      const configPath = resolve(
        import.meta.dirname,
        "../data/config.example.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
        keywords: Record<string, string[]>;
      };
      const categories = Object.keys(config.keywords);
      expect(categories.length).toBeGreaterThan(0);
    });
  });
});
