# Clancy vs GSD vs PAUL

Three Claude Code workflow tools — different philosophies, different sweet spots.

| | [Clancy](https://github.com/Pushedskydiver/clancy) | [GSD](https://github.com/gsd-build/get-shit-done) | [PAUL](https://github.com/ChristopherKahler/paul) |
|---|---|---|---|
| **Purpose** | Autonomous ticket implementation | Structured project phases | In-session efficiency |
| **Board integration** | Jira, GitHub Issues, Linear | None | None |
| **Automation level** | Fully autonomous (AFK loop) | Human-approved phases | Human-driven |
| **Context loading** | All docs on every ticket | Phase-specific files per step | In-session preference over subagents |
| **Token usage** | Heavy (fresh session per ticket) | Moderate (targeted per phase) | Lean (avoids subagent cold-starts) |
| **Setup** | `npx chief-clancy` | Manual | Manual |

---

## When to use Clancy

You have a ticket board (Jira, GitHub Issues, or Linear) with well-scoped, assigned tickets and you want Claude to work through them autonomously while you do other things.

Clancy is the right tool if:
- Your team already works from a backlog
- You want minimal human involvement per ticket
- You're comfortable with autonomous git operations (branch, merge, commit)

Clancy is the wrong tool if:
- You don't use a ticket board
- You want to review and approve each implementation step
- Token cost is a hard constraint — each ticket is a fresh session that reads your full docs

---

## When to use GSD

You're working on a project in defined phases (plan, build, review) and want structured handoffs between steps with human sign-off.

GSD loads context modularly — different files for different phases — which keeps each step lean. It's better suited to longer, more open-ended projects where you want to stay in the loop at each transition rather than hand off entirely.

---

## When to use PAUL

You care primarily about token efficiency within a Claude Code session. PAUL avoids spinning up subagents where possible (each subagent cold-start costs ~2-3k tokens) and prefers doing work in-session.

It's not a board tool or a project phase tool — it's a set of conventions for working more efficiently inside a single Claude session.

---

## They're not mutually exclusive

PAUL's efficiency principles apply inside the Claude sessions Clancy spawns. GSD's doc structure is different from Clancy's `.clancy/docs/` convention but the underlying idea — give Claude focused, relevant context — is the same.

If you use Clancy and find token costs are high, keeping your `.clancy/docs/` files concise (the GSD/PAUL instinct) is the right lever to pull.
