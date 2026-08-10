/**
 * Governance overlay (methodology: TRD §2, step 6), a read-only attach.
 *
 * Maps agents -> the tasks they run -> the identity/scopes they hold, and flags
 * least-privilege gaps against what each task actually requires. Read-only: it
 * reports gaps, it never mutates the client's IdP/estate. In financial-services
 * model-risk, this rides alongside the quality artifact as a control-evidence
 * attach (SR 11-7 inventory + access separation).
 */

export interface AgentRecord {
  agentId: string;
  /** Identity scopes/permissions the agent currently holds. */
  grantedScopes: string[];
  /** Task families the agent is observed to run. */
  tasks: string[];
}

export interface TaskScopeRequirement {
  family: string;
  /** Scopes a task family legitimately requires. */
  requiredScopes: string[];
}

export type GovernanceSeverity = "info" | "warning";

export interface GovernanceFinding {
  agentId: string;
  code: "excess_scope" | "missing_scope" | "untracked_task";
  severity: GovernanceSeverity;
  detail: string;
  scopes: string[];
}

/**
 * Compare each agent's granted scopes to the union of scopes its tasks require.
 * Excess scope (held but not required) is a least-privilege warning; missing
 * scope (required but not held) is an info note (the task may fail, not a risk);
 * a task with no requirement record is flagged untracked.
 */
export function mapGovernance(agents: readonly AgentRecord[], requirements: readonly TaskScopeRequirement[]): GovernanceFinding[] {
  const reqByFamily = new Map(requirements.map((r) => [r.family, new Set(r.requiredScopes)]));
  const findings: GovernanceFinding[] = [];

  for (const agent of [...agents].sort((a, b) => a.agentId.localeCompare(b.agentId))) {
    const required = new Set<string>();
    for (const family of agent.tasks) {
      const req = reqByFamily.get(family);
      if (req === undefined) {
        findings.push({ agentId: agent.agentId, code: "untracked_task", severity: "warning", detail: `task family '${family}' has no scope requirement on record`, scopes: [] });
        continue;
      }
      for (const s of req) required.add(s);
    }

    const granted = new Set(agent.grantedScopes);
    const excess = [...granted].filter((s) => !required.has(s)).sort();
    const missing = [...required].filter((s) => !granted.has(s)).sort();

    if (excess.length > 0) {
      findings.push({ agentId: agent.agentId, code: "excess_scope", severity: "warning", detail: `agent holds scopes no observed task requires (least-privilege gap)`, scopes: excess });
    }
    if (missing.length > 0) {
      findings.push({ agentId: agent.agentId, code: "missing_scope", severity: "info", detail: `agent lacks scopes its observed tasks require`, scopes: missing });
    }
  }

  return findings;
}
