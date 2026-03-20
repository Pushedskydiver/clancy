# Git Conventions

## Branch Strategy

```
main ← feature/ | fix/ | chore/
```

All work branches from `main` and merges back to `main` via PR.

### Branches

| Branch | Purpose | Branched from | Merges into |
|---|---|---|---|
| `main` | Production code, tagged releases | — | — |
| `feature/<name>` | New features | `main` | `main` |
| `fix/<name>` | Bug fixes | `main` | `main` |
| `chore/<name>` | Maintenance, deps, config | `main` | `main` |

### Rules

- **If it runs, it needs a PR.** TypeScript (`src/`, `hooks/`), tests, executable markdown (`src/roles/`, `src/templates/`, `src/agents/`), package.json, CHANGELOG.md, CI config (`.github/`) — always via branch + PR.
- **If it's only read, direct to main is fine.** Decision docs (`docs/decisions/`), glossary, architecture docs (`docs/`), CLAUDE.md doc link updates, README badge/link fixes, typo corrections.
- Delete branches after merging
- CI must pass before merging

## Branch Naming

```
type/short-description
```

Types: `feature`, `fix`, `chore`

Examples:

```
feature/context-monitor
fix/push-protection-test-values
chore/update-dependencies
```

Keep names short and descriptive. No ticket numbers (Clancy doesn't use an external board for its own development).

## Commit Messages

Format:

```
<gitmoji> <type>(scope): description
```

The gitmoji comes first, then the conventional commit type. Scope is optional.

### Types

| Type | Gitmoji | Use for |
|---|---|---|
| `feat` | ✨ | New feature |
| `fix` | 🐛 | Bug fix |
| `chore` | 📦 | Maintenance, deps, config |
| `refactor` | ♻️ | Code change that doesn't fix or add |
| `test` | ✅ | Adding or updating tests |
| `docs` | 📝 | Documentation only |
| `style` | 💄 | Formatting, cosmetic (no logic change) |
| `perf` | ⚡️ | Performance improvement |
| `security` | 🔒 | Security fix |
| `remove` | 🔥 | Removing code or files |

### Examples

```
✨ feat: add credential guard PreToolUse hook
🐛 fix: use correct statusLine key and object format
📝 docs: add 0.2.0 entry to CHANGELOG
💄 style: update badges to for-the-badge
✅ test: add credential guard unit tests
♻️ refactor: extract preflight into shared function
📦 chore: bump version to 0.2.0
```

## Merge Strategy

- Feature/fix/chore branches: **squash merge** into `main`

## Release Flow

### Stable releases

1. Include version bump (`package.json`) and `CHANGELOG.md` entry in your PR
2. Squash merge PR to `main`
3. GitHub Actions automatically: creates tag → builds → creates GitHub Release
4. Publish to npm: `npm publish`

That's it. Tagging, building, and the GitHub Release are fully automated.

### Beta / pre-releases

1. Bump to a pre-release version in your branch (e.g. `0.4.0-beta.1`)
2. Add a CHANGELOG entry under `## [0.4.0-beta.1]`
3. Squash merge PR to `main`
4. GitHub Actions creates tag `v0.4.0-beta.1` and marks the release as a pre-release
5. Publish: `npm publish --tag beta`
6. Users install with: `npx chief-clancy@beta`
7. When ready for stable: bump to `0.4.0`, merge, automation tags, publish normally

## Tagging

- Tags follow semver: `vMAJOR.MINOR.PATCH`
- Pre-release tags: `vMAJOR.MINOR.PATCH-beta.N`
- Tags are created automatically by GitHub Actions when a version bump is detected on `main`
- Pushing a tag triggers the release workflow (build + GitHub Release)
