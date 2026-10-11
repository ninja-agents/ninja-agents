export interface SprintMembership {
  id: number;
  name: string;
  state: "closed" | "active" | "future";
}

export function normalizeSprintMemberships(
  value: unknown,
): SprintMembership[] | null {
  if (!Array.isArray(value)) return null;
  const byId = new Map<number, SprintMembership>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { id, name, state } = entry as Record<string, unknown>;
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof name !== "string" ||
      name.trim() === "" ||
      (state !== "closed" && state !== "active" && state !== "future")
    ) {
      return null;
    }
    const trimmedName = name.trim();
    const previous = byId.get(id);
    if (
      previous !== undefined &&
      (previous.name !== trimmedName || previous.state !== state)
    ) {
      return null;
    }
    byId.set(id, { id, name: trimmedName, state });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
