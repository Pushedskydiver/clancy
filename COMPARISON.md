# Clancy vs GSD vs PAUL

Three Claude Code workflow tools — different philosophies, different sweet spots.

| | [Clancy](https://github.com/Pushedskydiver/clancy) | [GSD](https://github.com/gsd-build/get-shit-done) | [PAUL](https://github.com/ChristopherKahler/paul) |
|---|---|---|---|
| **Purpose** | Autonomous ticket implementation | Structured project phases | In-session efficiency |
| **Board integration** | Jira, GitHub Issues, Linear | None | None |
| **Runtime support** | Claude Code | Claude Code, OpenCode, Gemini, Codex | Claude Code |
| **Automation level** | Fully autonomous (AFK loop) | Semi-autonomous (approve roadmap, then walk away) | Human-driven |
| **Context loading** | All docs on every ticket | Fresh subagent per phase, main session stays lean | In-session by default, subagents for bounded research only |
| **Token usage** | Heavy (fresh session per ticket) | Moderate (subagents per phase, main session ~30-40%) | Lean (avoids subagent cold-starts) |
| **Setup** | `npx chief-clancy` | `npx get-shit-done-cc@latest` | `npx paul-framework` |

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

You're working on a larger project and want structured phases — research, plan, build, review — with a human sign-off on the roadmap before the work begins. Once you've approved the plan, GSD can run autonomously through execution (it has a YOLO mode for hands-off runs).

GSD spawns fresh subagents per phase so each gets a clean 200k context window for implementation, while your main session stays lean. It also supports multiple AI runtimes beyond Claude Code (OpenCode, Gemini, Codex), which makes it a better fit if your team doesn't standardise on Claude.

---

## When to use PAUL

You care primarily about efficiency within a Claude Code session. PAUL stays in-session by default — avoiding subagent cold-starts (~2-3k tokens each) — and reserves parallel agents only for bounded research tasks where the parallelisation is genuinely worth it.

PAUL also adds explicit quality gates (acceptance criteria in Given/When/Then format), structured handoff files for zero-context resumption, and hard scope boundaries. It's not a board tool or a project phase tool — it's a set of conventions for working more carefully and efficiently inside a single session.

---

## They're not mutually exclusive

PAUL's efficiency principles apply inside the Claude sessions Clancy spawns. GSD's doc structure is different from Clancy's `.clancy/docs/` convention but the underlying idea — give Claude focused, relevant context — is the same.

If you use Clancy and find token costs are high, keeping your `.clancy/docs/` files concise (the GSD/PAUL instinct) is the right lever to pull.
