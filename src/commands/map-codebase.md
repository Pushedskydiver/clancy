# /clancy:map-codebase

Scan your codebase with 5 parallel specialist agents and write 10 structured docs to .clancy/docs/.

Agents run simultaneously:
- tech — STACK.md, INTEGRATIONS.md
- arch — ARCHITECTURE.md
- quality — CONVENTIONS.md, TESTING.md, GIT.md, DEFINITION-OF-DONE.md
- design — DESIGN-SYSTEM.md, ACCESSIBILITY.md
- concerns — CONCERNS.md

Takes approximately 2 minutes for a typical codebase.

@.claude/clancy/workflows/map-codebase.md

Run the 5-agent scan as documented in the workflow above. Spawn all agents simultaneously.
