#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface Config {
  jira: {
    cloud_id: string;
    cloud_uuid: string;
  };
  source: {
    jql: string;
    bugKeywords: {
      nmstate: string[];
      nmstateSummaryOnly: string[];
      networking: string[];
      networkingSummaryOnly: string[];
    };
    ciExcludePatterns: string[];
    manualExcludeKeys: string[];
    inFlightStatuses: string[];
    rfeTypeWatchPatterns: string[];
  };
  targets: {
    bugs: {
      project: string;
      projectId: string;
      bugIssueTypeId: string;
      components: string[];
    };
    rfes: {
      project: string;
      nmstateComponents: string[];
      networkingComponents: string[];
    };
  };
}

interface JiraIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    description?: string;
    issuetype: { name: string };
    status: { name: string };
    versions?: Array<{ name: string }>;
    fixVersions?: Array<{ name: string }>;
  };
}

interface ClassifiedTicket {
  key: string;
  numeric_id: string;
  summary: string;
  issuetype: string;
  status: string;
  target_project: string;
  target_component: string;
  reason: string;
  review_flag: string;
  possible_duplicate: string;
}

function matchesKeyword(text: string, keywords: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const keyword of keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}

function classifyTicket(issue: JiraIssue, config: Config): ClassifiedTicket {
  const summary = issue.fields.summary || "";
  const description = issue.fields.description || "";
  const issuetype = issue.fields.issuetype.name;
  const status = issue.fields.status.name;

  let target_project = "";
  // eslint-disable-next-line no-useless-assignment
  let target_component = "";
  let reason = "";
  let review_flag = "";

  // Gate 1: CI/Tooling Exclusion
  if (config.source.manualExcludeKeys.includes(issue.key)) {
    return {
      key: issue.key,
      numeric_id: issue.id,
      summary,
      issuetype,
      status,
      target_project: "",
      target_component: "",
      reason: "Manually excluded: not a networking ticket",
      review_flag: "ci-excluded",
      possible_duplicate: "",
    };
  }

  for (const pattern of config.source.ciExcludePatterns) {
    if (summary.toLowerCase().includes(pattern.toLowerCase())) {
      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project: "",
        target_component: "",
        reason: `CI/tooling ticket excluded: ${pattern}`,
        review_flag: "ci-excluded",
        possible_duplicate: "",
      };
    }
  }

  // Gate 3: Bug-as-RFE Detection (before routing)
  if (issuetype === "Bug") {
    for (const pattern of config.source.rfeTypeWatchPatterns) {
      if (summary.toLowerCase().includes(pattern.toLowerCase())) {
        review_flag = "type-mismatch-suspect";
        reason = ` [TYPE SUSPECT: summary pattern '${pattern}' suggests this may be a Feature Request]`;
        break;
      }
    }
  }

  // Gate 4: Feature Request Routing
  if (issuetype === "Feature Request") {
    // Check summary for nmstate keywords
    const nmstateSummaryMatch = matchesKeyword(
      summary,
      config.source.bugKeywords.nmstate,
    );
    if (nmstateSummaryMatch) {
      target_project = config.targets.rfes.project;
      target_component = config.targets.rfes.nmstateComponents.join(", ");
      reason = `Feature Request → RFE; nmstate keyword '${nmstateSummaryMatch}' in summary`;

      // Gate 2: In-Flight Status (after routing)
      if (config.source.inFlightStatuses.includes(status)) {
        review_flag = "review-required";
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Check summary for networking keywords
    const networkingSummaryMatch = matchesKeyword(
      summary,
      config.source.bugKeywords.networking,
    );
    if (networkingSummaryMatch) {
      target_project = config.targets.rfes.project;
      target_component = config.targets.rfes.networkingComponents.join(", ");
      reason = `Feature Request → RFE; networking keyword '${networkingSummaryMatch}' in summary`;

      if (config.source.inFlightStatuses.includes(status)) {
        review_flag = "review-required";
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Check summary for nmstateSummaryOnly keywords
    const nmstateSummaryOnlyMatch = matchesKeyword(
      summary,
      config.source.bugKeywords.nmstateSummaryOnly,
    );
    if (nmstateSummaryOnlyMatch) {
      target_project = config.targets.rfes.project;
      target_component = config.targets.rfes.nmstateComponents.join(", ");
      reason = `Feature Request → RFE; nmstate keyword '${nmstateSummaryOnlyMatch}' in summary`;

      if (config.source.inFlightStatuses.includes(status)) {
        review_flag = "review-required";
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Check summary for networkingSummaryOnly keywords
    const networkingSummaryOnlyMatch = matchesKeyword(
      summary,
      config.source.bugKeywords.networkingSummaryOnly,
    );
    if (networkingSummaryOnlyMatch) {
      target_project = config.targets.rfes.project;
      target_component = config.targets.rfes.networkingComponents.join(", ");
      reason = `Feature Request → RFE; networking keyword '${networkingSummaryOnlyMatch}' in summary (summary-only)`;

      if (config.source.inFlightStatuses.includes(status)) {
        review_flag = "review-required";
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Description-only match (excluding summary-only keywords)
    const nmstateDescMatch = matchesKeyword(
      description,
      config.source.bugKeywords.nmstate,
    );
    const networkingDescMatch = matchesKeyword(
      description,
      config.source.bugKeywords.networking,
    );

    if (nmstateDescMatch || networkingDescMatch) {
      review_flag = "review-required";
      target_project = config.targets.rfes.project;

      if (nmstateDescMatch) {
        target_component = config.targets.rfes.nmstateComponents.join(", ");
        reason = `Feature Request → RFE; keyword '${nmstateDescMatch}' in description only [REVIEW REQUIRED: confirm this belongs to networking team]`;
      } else {
        target_component = config.targets.rfes.networkingComponents.join(", ");
        reason = `Feature Request → RFE; keyword '${networkingDescMatch}' in description only [REVIEW REQUIRED: confirm this belongs to networking team]`;
      }

      if (config.source.inFlightStatuses.includes(status)) {
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // No keyword match
    review_flag = "unclassified";
    if (config.source.inFlightStatuses.includes(status)) {
      review_flag = "in-flight-no-action";
    }

    return {
      key: issue.key,
      numeric_id: issue.id,
      summary,
      issuetype,
      status,
      target_project: "",
      target_component: "",
      reason:
        "Feature Request: no networking or nmstate keyword in summary or description — stays in CNV",
      review_flag,
      possible_duplicate: "",
    };
  }

  // Gate 5: Bug Component Routing
  if (issuetype === "Bug") {
    // Step A: Check summary for nmstate keywords
    const nmstateSummaryMatch = matchesKeyword(summary, [
      ...config.source.bugKeywords.nmstate,
      ...config.source.bugKeywords.nmstateSummaryOnly,
    ]);

    // Step B: Check summary for networking keywords
    const networkingSummaryMatch = matchesKeyword(
      summary,
      config.source.bugKeywords.networking,
    );

    // Step C: Dual-keyword conflict
    if (nmstateSummaryMatch && networkingSummaryMatch) {
      review_flag = review_flag
        ? `${review_flag},review-required`
        : "review-required";
      target_project = config.targets.bugs.project;
      target_component = "Networking / networking-console-plugin";
      reason =
        `Bug: dual-keyword conflict in summary (nmstate: '${nmstateSummaryMatch}' vs networking: '${networkingSummaryMatch}') [REVIEW REQUIRED: networking keyword wins by default]` +
        reason;

      if (config.source.inFlightStatuses.includes(status)) {
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Step D: nmstate wins
    if (nmstateSummaryMatch) {
      target_project = config.targets.bugs.project;
      target_component = "Networking / nmstate-console-plugin";
      reason =
        `Bug: nmstate keyword '${nmstateSummaryMatch}' matched in summary` +
        reason;

      if (config.source.inFlightStatuses.includes(status)) {
        review_flag = review_flag
          ? `${review_flag},review-required`
          : "review-required";
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Step E: networking wins
    if (networkingSummaryMatch) {
      target_project = config.targets.bugs.project;
      target_component = "Networking / networking-console-plugin";
      reason =
        `Bug: networking keyword '${networkingSummaryMatch}' matched in summary` +
        reason;

      if (config.source.inFlightStatuses.includes(status)) {
        review_flag = review_flag
          ? `${review_flag},review-required`
          : "review-required";
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Step F: Description-only keyword match (only unrestricted keywords)
    const nmstateDescMatch = matchesKeyword(
      description,
      config.source.bugKeywords.nmstate,
    );
    const networkingDescMatch = matchesKeyword(
      description,
      config.source.bugKeywords.networking,
    );

    if (nmstateDescMatch || networkingDescMatch) {
      review_flag = review_flag
        ? `${review_flag},review-required`
        : "review-required";
      target_project = config.targets.bugs.project;

      if (networkingDescMatch) {
        // networking wins in dual description match
        target_component = "Networking / networking-console-plugin";
        reason =
          `Bug: keyword '${networkingDescMatch}' in description only — proposed move to ${target_project}/${target_component} pending manual approval [REVIEW REQUIRED: summary gives no ownership signal]` +
          reason;
      } else {
        target_component = "Networking / nmstate-console-plugin";
        reason =
          `Bug: keyword '${nmstateDescMatch}' in description only — proposed move to ${target_project}/${target_component} pending manual approval [REVIEW REQUIRED: summary gives no ownership signal]` +
          reason;
      }

      if (config.source.inFlightStatuses.includes(status)) {
        reason += ` [IN-FLIGHT: status=${status} — requires manual approval before move]`;
      }

      return {
        key: issue.key,
        numeric_id: issue.id,
        summary,
        issuetype,
        status,
        target_project,
        target_component,
        reason,
        review_flag,
        possible_duplicate: "",
      };
    }

    // Step G: No keyword match
    review_flag = review_flag || "unclassified";
    if (config.source.inFlightStatuses.includes(status) && !target_project) {
      review_flag = "in-flight-no-action";
    }

    return {
      key: issue.key,
      numeric_id: issue.id,
      summary,
      issuetype,
      status,
      target_project: "",
      target_component: "",
      reason:
        "Bug: no networking or nmstate keyword in summary or description — stays in CNV",
      review_flag,
      possible_duplicate: "",
    };
  }

  // Fallback
  return {
    key: issue.key,
    numeric_id: issue.id,
    summary,
    issuetype,
    status,
    target_project: "",
    target_component: "",
    reason: "Unknown issue type",
    review_flag: "unclassified",
    possible_duplicate: "",
  };
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: classify-tickets.ts <issues-json-file> <config-json-file>",
  );
  process.exit(1);
}

const issuesFile = args[0];
const configFile = args[1];

const issuesData = JSON.parse(readFileSync(issuesFile, "utf-8")) as {
  issues: { nodes: JiraIssue[] };
};
const config = JSON.parse(readFileSync(configFile, "utf-8")) as Config;

const issues: JiraIssue[] = issuesData.issues.nodes;

console.log(`[3/7] Classifying ${issues.length} tickets...`);

const classified: ClassifiedTicket[] = issues.map((issue) =>
  classifyTicket(issue, config),
);

// Save to CSV
const csvPath = join(import.meta.dirname, "../data/cache/tickets.csv");
const header =
  "key,numeric_id,summary,issuetype,status,target_project,target_component,reason,review_flag,possible_duplicate";
const rows = classified.map((ticket) => {
  return [
    escapeCsvField(ticket.key),
    escapeCsvField(ticket.numeric_id),
    escapeCsvField(ticket.summary),
    escapeCsvField(ticket.issuetype),
    escapeCsvField(ticket.status),
    escapeCsvField(ticket.target_project),
    escapeCsvField(ticket.target_component),
    escapeCsvField(ticket.reason),
    escapeCsvField(ticket.review_flag),
    escapeCsvField(ticket.possible_duplicate),
  ].join(",");
});

writeFileSync(csvPath, [header, ...rows].join("\n"), "utf-8");

console.log(`Saved ${classified.length} classified tickets to ${csvPath}`);

// Print summary
const confirmed = classified.filter((t) => !t.review_flag && t.target_project);
const flagged = classified.filter(
  (t) => t.review_flag && t.review_flag.includes("review-required"),
);
const excluded = classified.filter((t) => t.review_flag === "ci-excluded");
const unclassified = classified.filter((t) => t.review_flag === "unclassified");
const inFlightNoAction = classified.filter(
  (t) => t.review_flag === "in-flight-no-action",
);

console.log(`\nSummary:`);
console.log(`  Confirmed moves: ${confirmed.length}`);
console.log(`  Flagged for review: ${flagged.length}`);
console.log(`  CI/tooling excluded: ${excluded.length}`);
console.log(`  Unclassified: ${unclassified.length}`);
console.log(`  In-flight / no action: ${inFlightNoAction.length}`);
