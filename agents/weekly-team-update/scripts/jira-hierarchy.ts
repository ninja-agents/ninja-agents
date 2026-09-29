export interface HierarchyNode {
  readonly key: string;
  readonly summary: string;
  readonly issue_type: string;
  readonly parent_key: string;
}

export interface ParsedHierarchyIssue {
  readonly node: HierarchyNode;
  readonly parent: HierarchyNode | null;
}

export interface HierarchyWork {
  readonly product: string;
  readonly key: string;
  readonly summary: string;
  readonly kind: string;
  readonly completed: boolean;
}

export interface HierarchyGroup {
  readonly product: string;
  readonly feature: HierarchyNode | null;
  readonly epic: HierarchyNode | null;
  readonly work: HierarchyWork[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseHierarchyIssue(
  issue: unknown,
): ParsedHierarchyIssue | null {
  if (!isRecord(issue) || !isRecord(issue.fields)) return null;
  const key = field(issue.key);
  if (!key) return null;

  const fields = issue.fields;
  const issueType = isRecord(fields.issuetype)
    ? field(fields.issuetype.name)
    : "";
  const parentFields = isRecord(fields.parent) ? fields.parent : null;
  const parentKey = parentFields ? field(parentFields.key) : "";
  const embeddedFields =
    parentFields && isRecord(parentFields.fields) ? parentFields.fields : null;
  const embeddedType =
    embeddedFields && isRecord(embeddedFields.issuetype)
      ? field(embeddedFields.issuetype.name)
      : "";

  return {
    node: {
      key,
      summary: field(fields.summary),
      issue_type: issueType,
      parent_key: parentKey,
    },
    parent: parentKey
      ? {
          key: parentKey,
          summary: embeddedFields ? field(embeddedFields.summary) : "",
          issue_type: embeddedType,
          parent_key: "",
        }
      : null,
  };
}

function ancestry(
  key: string,
  nodes: ReadonlyMap<string, HierarchyNode>,
): { feature: HierarchyNode | null; epic: HierarchyNode | null } {
  let current = nodes.get(key);
  let feature: HierarchyNode | null = null;
  let epic: HierarchyNode | null = null;
  const visited = new Set<string>();

  while (current && !visited.has(current.key)) {
    visited.add(current.key);
    if (current.issue_type === "Epic" && epic === null) epic = current;
    if (
      (current.issue_type === "Feature" ||
        current.issue_type === "Feature Request") &&
      feature === null
    ) {
      feature = current;
      break;
    }
    current = nodes.get(current.parent_key);
  }

  return { feature, epic };
}

export function groupHierarchy(
  work: readonly HierarchyWork[],
  nodes: ReadonlyMap<string, HierarchyNode>,
  productOrder: readonly string[],
): HierarchyGroup[] {
  const groups = new Map<string, HierarchyGroup>();

  for (const item of work) {
    const { feature, epic } = ancestry(item.key, nodes);
    if (!feature && !epic) continue;
    const groupKey = [item.product, feature?.key ?? "", epic?.key ?? ""].join(
      "|",
    );
    let group = groups.get(groupKey);
    if (!group) {
      group = { product: item.product, feature, epic, work: [] };
      groups.set(groupKey, group);
    }
    if (item.key === feature?.key || item.key === epic?.key) continue;

    const index = group.work.findIndex((entry) => entry.key === item.key);
    if (index < 0) {
      group.work.push(item);
    } else {
      const existing = group.work[index];
      if (
        (existing.kind === "PR" && item.kind !== "PR") ||
        (existing.kind === item.kind && item.completed && !existing.completed)
      ) {
        group.work[index] = item;
      }
    }
  }

  const rank = new Map(productOrder.map((product, index) => [product, index]));
  return [...groups.values()]
    .map((group) => ({
      ...group,
      work: [...group.work].sort((a, b) => a.key.localeCompare(b.key)),
    }))
    .sort(
      (a, b) =>
        (rank.get(a.product) ?? 999) - (rank.get(b.product) ?? 999) ||
        (a.feature?.key ?? "").localeCompare(b.feature?.key ?? "") ||
        (a.epic?.key ?? "").localeCompare(b.epic?.key ?? ""),
    );
}

export function formatHierarchyContext(
  work: readonly HierarchyWork[],
  nodes: ReadonlyMap<string, HierarchyNode>,
  jiraBaseUrl: string,
  productOrder: readonly string[],
): string {
  const groups = groupHierarchy(work, nodes, productOrder);
  const lines = [
    "--- Jira Hierarchy Context ---",
    "Feature and Epic links show ancestry; only listed work items count as weekly activity.",
  ];
  let currentProduct = "";
  let currentFeature = "";
  const baseUrl = jiraBaseUrl.replace(/\/$/, "");

  for (const group of groups) {
    if (group.product !== currentProduct) {
      currentProduct = group.product;
      currentFeature = "";
      lines.push("", "### " + currentProduct);
    }
    if (group.feature && group.feature.key !== currentFeature) {
      currentFeature = group.feature.key;
      lines.push(
        "- Feature [" +
          group.feature.key +
          "](" +
          baseUrl +
          "/" +
          group.feature.key +
          ") " +
          group.feature.summary,
      );
    }
    if (group.epic) {
      const prefix = group.feature ? "  " : "";
      lines.push(
        prefix +
          "- Epic [" +
          group.epic.key +
          "](" +
          baseUrl +
          "/" +
          group.epic.key +
          ") " +
          group.epic.summary,
      );
    }
    const indent = group.feature && group.epic ? "    " : "  ";
    for (const item of group.work) {
      lines.push(
        indent +
          "- " +
          (item.completed ? "Completed " : "In progress ") +
          item.kind +
          " [" +
          item.key +
          "](" +
          baseUrl +
          "/" +
          item.key +
          ") " +
          item.summary.replace(/\s+/g, " "),
      );
    }
  }

  return lines.join("\n");
}
