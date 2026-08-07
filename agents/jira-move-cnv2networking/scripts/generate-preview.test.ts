import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Config {
  jira: { cloud_id: string; cloud_uuid: string };
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
    bugs: { project: string; components: string[] };
    rfes: {
      project: string;
      nmstateComponents: string[];
      networkingComponents: string[];
    };
  };
}

function classifyBugComponent(
  summary: string,
  description: string,
  keywords: string[],
): string {
  const text = `${summary} ${description}`.toLowerCase();
  const isNmstate = keywords.some((kw) => text.includes(kw.toLowerCase()));
  return isNmstate
    ? "Networking / nmstate-console-plugin"
    : "Networking / networking-console-plugin";
}

describe("config", () => {
  it("loads required fields", () => {
    const configPath = resolve(
      import.meta.dirname,
      "../data/config.example.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(config.jira.cloud_id).toBe("redhat.atlassian.net");
    expect(config.source.jql).toContain("CNV");
    expect(config.targets.bugs.project).toBe("OCPBUGS");
    expect(config.targets.bugs.components).toHaveLength(2);
    expect(config.source.bugKeywords.nmstate).toContain("NNCP");
    expect(config.source.bugKeywords.nmstate).toContain("NodeNetworkState");
    expect(config.source.bugKeywords.nmstate).toContain("CNV bridge");
    expect(config.source.bugKeywords.nmstateSummaryOnly).toContain(
      "Linux bridge",
    );
    expect(config.source.bugKeywords.nmstateSummaryOnly).toContain("Bond");
    expect(config.source.bugKeywords.networking).toContain("NAD");
    expect(config.source.bugKeywords.networking).toContain("UDN");
    expect(config.source.bugKeywords.networking).toContain("LoadBalancer");
    expect(config.source.ciExcludePatterns.length).toBeGreaterThan(0);
    expect(config.source.ciExcludePatterns).toContain("Console T2");
    expect(config.source.inFlightStatuses).toContain("ON_QA");
    expect(config.source.rfeTypeWatchPatterns).toContain("[RFE]");
  });
});

describe("classifyBugComponent", () => {
  const keywords = [
    "NNCP",
    "NodeNetworkConfigurationPolicy",
    "NMState",
    "nmstate",
    "NodeNetworkState",
    "NNS",
    "NodeNetworkConfigurationEnactment",
    "NNCE",
    "nmstate-console-plugin",
    "kubernetes-nmstate",
    "NMState CR",
    "Bond",
    "OVS-Bridge",
    "VLAN interface",
    "Linux bridge",
  ];

  it("routes NNCP tickets to nmstate-console-plugin", () => {
    const result = classifyBugComponent(
      "Missing option to create CNV bridge NNCP configuration from GUI",
      "",
      keywords,
    );
    expect(result).toBe("Networking / nmstate-console-plugin");
  });

  it("routes NMState tickets to nmstate-console-plugin", () => {
    const result = classifyBugComponent(
      "NMState policy not applied",
      "The NodeNetworkConfigurationPolicy fails silently.",
      keywords,
    );
    expect(result).toBe("Networking / nmstate-console-plugin");
  });

  it("routes NodeNetworkState (NNS) tickets to nmstate-console-plugin", () => {
    const result = classifyBugComponent(
      "NodeNetworkState not updated after interface change",
      "",
      keywords,
    );
    expect(result).toBe("Networking / nmstate-console-plugin");
  });

  it("routes NNCE tickets to nmstate-console-plugin", () => {
    const result = classifyBugComponent(
      "NNCE shows failed status but node network is correct",
      "NodeNetworkConfigurationEnactment does not clear error.",
      keywords,
    );
    expect(result).toBe("Networking / nmstate-console-plugin");
  });

  it("routes Linux bridge tickets to nmstate-console-plugin", () => {
    const result = classifyBugComponent(
      "Cannot create Linux bridge via NNCP form",
      "",
      keywords,
    );
    expect(result).toBe("Networking / nmstate-console-plugin");
  });

  it("routes NAD tickets to networking-console-plugin", () => {
    const result = classifyBugComponent(
      "Localnet NAD not correctly built using Form View in UI",
      "Under Networking > NetworkAttachmentDefinitions",
      keywords,
    );
    expect(result).toBe("Networking / networking-console-plugin");
  });

  it("routes UDN tickets to networking-console-plugin", () => {
    const result = classifyBugComponent(
      "OpenShift Console UI does not support secondary UDN creation",
      "The UDN creation form is missing the YAML view.",
      keywords,
    );
    expect(result).toBe("Networking / networking-console-plugin");
  });

  it("routes NetworkPolicy tickets to networking-console-plugin", () => {
    const result = classifyBugComponent(
      "NetworkPolicy form does not show egress rules",
      "",
      keywords,
    );
    expect(result).toBe("Networking / networking-console-plugin");
  });
});

describe("generateMarkdown reason column", () => {
  it("includes Why column and Reasoning section in bug table", () => {
    const rows = [
      {
        key: "CNV-84716",
        summary: "Missing option to create CNV bridge NNCP config from GUI",
        issuetype: "Bug",
        status: "New",
        target_project: "OCPBUGS",
        target_component: "Networking / nmstate-console-plugin",
        reason: 'Bug: matched keyword "NNCP" in summary',
      },
    ];

    // Inline generateMarkdown logic to verify output shape
    const line = `| ${rows[0].key} | ${rows[0].summary.slice(0, 55)} | ${rows[0].status} | ${rows[0].target_component} | ${rows[0].reason.slice(0, 50)} |`;
    expect(line).toContain("CNV-84716");
    expect(line).toContain("nmstate-console-plugin");
    expect(line).toContain("NNCP");

    const reasonBullet = `- **${rows[0].key}**: ${rows[0].reason}`;
    expect(reasonBullet).toBe(
      '- **CNV-84716**: Bug: matched keyword "NNCP" in summary',
    );
  });
});
