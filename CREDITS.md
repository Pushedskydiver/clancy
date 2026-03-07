# Credits

## Geoffrey Huntley — the Ralph technique

Clancy is built on the **Ralph technique** coined by **Geoffrey Huntley** (ghuntley.com/ralph/).

In its original and purest form, Ralph is:

```bash
while :; do cat PROMPT.md | claude-code; done
```

Geoffrey's core principles:
- One task per loop
- Fresh context window every iteration (avoiding context rot)
- Monolithic single-process execution
- Trust the model to decide what's most important

These principles are the foundation everything in Clancy is built on.

**Clancy's creator took Geoffrey's raw technique and evolved it for professional team use:**
- Kanban board integration (Jira, GitHub Issues, Linear)
- Structured docs layer (`.clancy/docs/`) — 10 docs read before every run
- Epic branch git workflow with squash merge conventions
- Per-ticket progress logging
- Formal definition of done

Clancy packages and extends this with `map-codebase` (5-agent parallel codebase scanning) and makes the whole thing installable via `npx`.

**The Ralph technique is a methodology, not a packaged tool.** Geoffrey coined it and published it freely. Clancy is one implementation that builds on that idea.

---

## Naming

Clancy is named after **Chief Clancy Wiggum** from The Simpsons — Ralph Wiggum's dad. The name is a deliberate nod to the Ralph technique: Clancy equips and deploys Ralph before sending him to work. That's exactly what this tool does.

---

## Contributors

See [github.com/your-username/clancy/graphs/contributors](https://github.com/your-username/clancy/graphs/contributors).

---

## License

MIT. See [LICENSE](./LICENSE).
