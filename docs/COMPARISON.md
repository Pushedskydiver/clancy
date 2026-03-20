# Clancy vs GSD vs PAUL

Three Claude Code workflow tools — different philosophies, different sweet spots.

| | [Clancy](https://github.com/Pushedskydiver/clancy) | [GSD](https://github.com/gsd-build/get-shit-done) | [PAUL](https://github.com/ChristopherKahler/paul) |
|---|---|---|---|
| **Purpose** | Autonomous ticket implementation | Structured project phases | In-session efficiency |
| **Board integration** | Jira, GitHub Issues, Linear, Shortcut, Notion, Azure DevOps | None | None |
| **Roles** | Strategist, Planner, Implementer, Reviewer, Setup | Single workflow (discuss → plan → build → verify) | Plan-Apply-Unify loop |
| **Runtime support** | Claude Code | Claude Code, OpenCode, Gemini CLI, Codex | Claude Code |
| **Automation level** | Fully autonomous (AFK loop with verification gates) | Semi-autonomous (approve roadmap, then walk away) | Human-driven |
| **Quality gates** | Verification gate (lint/test/typecheck), self-healing retry, branch guard | Verification after each phase | BDD acceptance criteria |
| **Context loading** | All docs on every ticket, PostCompact re-injection | Fresh subagent per phase, main session stays lean | In-session by default, subagents for bounded research only |
| **Token usage** | Heavy (fresh session per ticket) | Moderate (subagents per phase, main session ~30-40%) | Lean (avoids subagent cold-starts) |
| **Crash recovery** | Lock file + resume detection + PR retry | None built-in | State files for session resumption |
| **Pipeline labels** | 3-stage lifecycle (brief → plan → build) | None | None |
| **Setup** | `npx chief-clancy` | `npx get-shit-done-cc@latest` | `npx paul-framework` |

---

## When to use Clancy

You have a ticket board (Jira, GitHub Issues, Linear, Shortcut, Notion, or Azure DevOps) with well-scoped, assigned tickets and you want Claude to work through them autonomously while you do other things.

Clancy is the right tool if:
- Your team already works from a backlog
- You want minimal human involvement per ticket
- You want the full pipeline: strategy briefs → planning → implementation → review
- You're comfortable with autonomous git operations (branch, PR, epic completion)
- You need crash recovery and verification gates for reliable AFK mode

Clancy is the wrong tool if:
- You don't use a ticket board
- You want to review and approve each implementation step
- Token cost is a hard constraint — each ticket is a fresh session that reads your full docs

---

## When to use GSD

You're working on a larger project and want structured phases — discuss, plan, build, verify — with a human sign-off at each phase before the work begins. Once you've approved a phase plan, GSD runs execution autonomously in parallel waves using fresh context windows per wave.

GSD spawns fresh subagents per phase so each gets a clean context window for implementation, while your main session stays lean. It also supports multiple AI runtimes beyond Claude Code (OpenCode, Gemini CLI, Codex), which makes it a better fit if your team doesn't standardise on Claude.

---

## When to use PAUL

PAUL (Plan-Apply-Unify Loop) is for developers who care primarily about quality and efficiency within a Claude Code session. It enforces a strict three-phase cycle: plan with BDD acceptance criteria (Given/When/Then), apply sequentially with verification steps, then unify to reconcile what was planned vs. what was built.

PAUL stays in-session by default and reserves parallel agents only for bounded research tasks. Structured state files (STATE.md, decision logs) enable zero-context resumption across sessions. It's not a board tool or a project phase tool — it's a set of conventions for working more carefully and deliberately inside a single session.

---

## They're not mutually exclusive

PAUL's efficiency principles apply inside the Claude sessions Clancy spawns. GSD's doc structure is different from Clancy's `.clancy/docs/` convention but the underlying idea — give Claude focused, relevant context — is the same.

If you use Clancy and find token costs are high, keeping your `.clancy/docs/` files concise (the GSD/PAUL instinct) is the right lever to pull.
