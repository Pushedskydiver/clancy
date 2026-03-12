# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting instead:
[Report a vulnerability](https://github.com/Pushedskydiver/clancy/security/advisories/new)

Include as much detail as you can: what you found, how to reproduce it, and what impact you think it has. You'll receive an acknowledgement within 5 business days.

---

## What counts as a security vulnerability

Report it if you find:

- The installer (`npx chief-clancy`) fetching or executing code from an unexpected source
- A board module or script that can be made to exfiltrate credentials or execute arbitrary commands beyond its documented purpose
- A workflow or agent prompt that can be manipulated to bypass Clancy's stated behaviour in a way that harms users
- A dependency with a known CVE that affects Clancy's attack surface

---

## What is intentional, not a vulnerability

- **`--dangerously-skip-permissions`** — Clancy invokes `claude --dangerously-skip-permissions` by design. This is documented, opt-in, and required for unattended operation. It is not a bug.
- **Full filesystem access during a run** — Claude has read/write access to your project when Clancy runs. This is documented and expected behaviour.
- **Credentials stored in `.clancy/.env`** — users are responsible for keeping this file secure. Clancy adds it to `.gitignore` automatically and documents the deny-list approach in the README.

---

## Supported versions

Only the latest published version on npm (`chief-clancy@latest`) receives security fixes. Older versions are not patched.

---

## Scope

This policy covers the code in this repository. It does not cover:

- Claude Code itself (report to Anthropic)
- Jira, GitHub, Linear, Figma, or Playwright (report to their respective maintainers)
- Vulnerabilities that require physical access to the user's machine
- Social engineering attacks
