import { describe, expect, it } from "vitest";
import {
  formatHierarchyContext,
  groupHierarchy,
  parseHierarchyIssue,
  type HierarchyNode,
} from "../jira-hierarchy.js";

describe("Jira hierarchy", () => {
  it("parses a Story and its embedded Epic parent", () => {
    expect(
      parseHierarchyIssue({
        key: "MTV-6763",
        fields: {
          summary: "Show provider warnings",
          issuetype: { name: "Story" },
          parent: {
            key: "MTV-6760",
            fields: {
              summary: "Provider conditions",
              issuetype: { name: "Epic" },
            },
          },
        },
      }),
    ).toEqual({
      node: {
        key: "MTV-6763",
        summary: "Show provider warnings",
        issue_type: "Story",
        parent_key: "MTV-6760",
      },
      parent: {
        key: "MTV-6760",
        summary: "Provider conditions",
        issue_type: "Epic",
        parent_key: "",
      },
    });
  });

  it("groups weekly work under linked Feature and Epic without duplicate PR references", () => {
    const nodes = new Map<string, HierarchyNode>([
      [
        "MTV-6763",
        {
          key: "MTV-6763",
          summary: "Show warnings",
          issue_type: "Story",
          parent_key: "MTV-6760",
        },
      ],
      [
        "MTV-6760",
        {
          key: "MTV-6760",
          summary: "Provider conditions",
          issue_type: "Epic",
          parent_key: "MTV-6426",
        },
      ],
      [
        "MTV-6426",
        {
          key: "MTV-6426",
          summary: "Provider improvements",
          issue_type: "Feature Request",
          parent_key: "",
        },
      ],
    ]);
    const work = [
      {
        product: "MTV",
        key: "MTV-6763",
        summary: "PR: warnings",
        kind: "PR",
        completed: true,
      },
      {
        product: "MTV",
        key: "MTV-6763",
        summary: "Show warnings",
        kind: "Story",
        completed: true,
      },
    ];
    const groups = groupHierarchy(work, nodes, ["MTV"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].work).toEqual([work[1]]);
    const context = formatHierarchyContext(
      work,
      nodes,
      "https://redhat.atlassian.net/browse",
      ["MTV"],
    );
    expect(context).toContain(
      "[MTV-6426](https://redhat.atlassian.net/browse/MTV-6426)",
    );
    expect(context).toContain(
      "[MTV-6760](https://redhat.atlassian.net/browse/MTV-6760)",
    );
    expect(context).toContain(
      "[MTV-6763](https://redhat.atlassian.net/browse/MTV-6763)",
    );
    expect(context).not.toContain("PR: warnings");
  });

  it("stops at missing parents and cycles", () => {
    const nodes = new Map<string, HierarchyNode>([
      [
        "MTA-1",
        {
          key: "MTA-1",
          summary: "Story",
          issue_type: "Story",
          parent_key: "MTA-2",
        },
      ],
      [
        "MTA-2",
        {
          key: "MTA-2",
          summary: "Epic",
          issue_type: "Epic",
          parent_key: "MTA-1",
        },
      ],
    ]);
    const work = [
      {
        product: "MTA",
        key: "MTA-1",
        summary: "Story",
        kind: "Story",
        completed: false,
      },
    ];
    expect(groupHierarchy(work, nodes, ["MTA"])[0].epic?.key).toBe("MTA-2");
    expect(
      groupHierarchy(work, new Map([["MTA-1", nodes.get("MTA-1")!]]), ["MTA"]),
    ).toEqual([]);
  });
});
