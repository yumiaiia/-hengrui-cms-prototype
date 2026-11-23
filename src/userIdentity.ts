import type { State, User } from "./model";

export const normalizeEmployeeId = (value: string) =>
  value.trim().toUpperCase();

/** An employee number maps to exactly one enabled user; email is never a fallback. */
export function findUserByEmployeeId(users: User[], value: string) {
  const employeeId = normalizeEmployeeId(value);
  if (!employeeId) return undefined;
  const matches = users.filter(
    (user) => normalizeEmployeeId(user.employeeId || "") === employeeId,
  );
  return matches.length === 1 && matches[0].enabled !== false
    ? matches[0]
    : undefined;
}

/** Only known prototype identities have sample employee numbers. Real accounts need theirs supplied. */
export function prepareEmployeeIdentity(s: State): State {
  if (s.employeeIdentityRevision === 1) return s;
  const next = structuredClone(s);
  const samples: Record<string, { accounts: string[]; employeeId: string }> = {
    u1: {
      accounts: ["chenlili", "admin@hengrui.example.com"],
      employeeId: "000001",
    },
    u2: {
      accounts: ["medical", "medical@hengrui.example.com"],
      employeeId: "000002",
    },
    u3: {
      accounts: ["operator", "operator@hengrui.example.com"],
      employeeId: "000003",
    },
  };
  const used = new Set(
    next.users.map((u) => normalizeEmployeeId(u.employeeId || "")),
  );
  for (const user of next.users) {
    const sample = samples[user.id];
    if (
      !user.employeeId &&
      sample &&
      sample.accounts.includes((user.account || "").trim().toLowerCase()) &&
      !used.has(sample.employeeId)
    ) {
      user.employeeId = sample.employeeId;
      used.add(sample.employeeId);
    }
  }
  next.employeeIdentityRevision = 1;
  return next;
}
