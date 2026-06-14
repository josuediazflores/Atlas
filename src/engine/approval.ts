/**
 * Human-in-the-loop approval gate.
 *
 * Reading the research platform is autonomous; *changing* it is not. Any write
 * the agent wants to make (for example, pausing recruiting on a saturated
 * study) is recorded as a PendingApproval and surfaced to a person. It is never
 * auto-executed against the platform — even with `--approve`, this build only
 * records the human decision; the actual write would call the real Great
 * Question MCP write tool, which is intentionally out of scope here.
 */

import type { PendingApproval } from './types.js';

export class ApprovalGate {
  private readonly approvals: PendingApproval[] = [];
  private seq = 0;

  constructor(private readonly autoApprove: boolean) {}

  /** Record a proposed write. Returns the pending (or human-approved) record. */
  propose(input: {
    action: string;
    tool: string;
    args: Record<string, unknown>;
    rationale: string;
  }): PendingApproval {
    const approval: PendingApproval = {
      id: `apr-${++this.seq}`,
      action: input.action,
      tool: input.tool,
      args: input.args,
      rationale: input.rationale,
      // Recording approval is NOT execution — the write itself never runs here.
      status: this.autoApprove ? 'approved' : 'pending',
    };
    this.approvals.push(approval);
    return approval;
  }

  all(): PendingApproval[] {
    return [...this.approvals];
  }
}
