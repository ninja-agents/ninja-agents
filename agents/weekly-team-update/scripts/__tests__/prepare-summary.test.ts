import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractSummary,
  prepareSummary,
  targetPathForDate,
} from "../prepare-summary.js";

const temporaryDirectories: string[] = [];
const report = [
  "# Team report",
  "September 29, 2026",
  "",
  "## Summary",
  "",
  "### Highlights",
  "- Shipped [work](https://example.com/work)",
  "",
  "### MTV",
  "- In progress: migration work",
  "",
  "## Data Quality Notes",
  "- Source warning",
  "",
  "## Completed This Week",
  "- Detailed work",
  "",
].join("\n");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("extractSummary", () => {
  it("copies Highlights and product summaries without later report sections", () => {
    expect(extractSummary(report)).toBe(
      "## Summary\n\n### Highlights\n- Shipped [work](https://example.com/work)\n\n### MTV\n- In progress: migration work\n",
    );
  });

  it("rejects missing, duplicate, and unfinished summaries", () => {
    expect(() => extractSummary("## Completed This Week\n- Work\n")).toThrow(
      "exactly one",
    );
    expect(() => extractSummary(`${report}\n## Summary\n`)).toThrow(
      "exactly one",
    );
    expect(() =>
      extractSummary(
        report.replace(
          "- In progress: migration work",
          "<!-- SUMMARY_PLACEHOLDER -->\n- (summary pending)",
        ),
      ),
    ).toThrow("placeholder");
    expect(() =>
      extractSummary(report.replace("### Highlights", "### Other")),
    ).toThrow("Highlights");
  });
});

describe("targetPathForDate", () => {
  it("uses the Friday in the source report's Monday-Sunday week", () => {
    expect(targetPathForDate("2026-09-29")).toBe(
      "reports/2026/2026-10-02/vme/cx/mnf.md",
    );
    expect(targetPathForDate("2026-10-04")).toBe(
      "reports/2026/2026-10-02/vme/cx/mnf.md",
    );
    expect(targetPathForDate("2026-12-31")).toBe(
      "reports/2027/2027-01-01/vme/cx/mnf.md",
    );
  });

  it("rejects impossible dates", () => {
    expect(() => targetPathForDate("2026-02-30")).toThrow(
      "Invalid report date",
    );
  });
});

describe("prepareSummary", () => {
  it("writes only the extracted summary and refuses to overwrite it", () => {
    const directory = mkdtempSync(join(tmpdir(), "team-summary-"));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, "weekly-update-2026-09-29.md");
    const checkout = join(directory, "checkout");
    mkdirSync(checkout);
    writeFileSync(reportPath, report);

    const targetPath = prepareSummary(reportPath, checkout);
    const destination = join(checkout, targetPath);
    expect(readFileSync(destination, "utf8")).toBe(extractSummary(report));
    expect(() => prepareSummary(reportPath, checkout)).toThrow(
      "already exists",
    );
    expect(readFileSync(destination, "utf8")).toBe(extractSummary(report));
  });
});
