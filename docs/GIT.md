# Git Conventions

## Branch Strategy

```
main ← release/vX.Y.Z ← develop ← feature/ | fix/ | chore/
main ← hotfix/vX.Y.Z
```

### Branches

| Branch | Purpose | Branched from | Merges into |
|---|---|---|---|
| `main` | Production code, tagged releases | — | — |
| `develop` | Integration branch | `main` (once) | — |
| `feature/<name>` | New features | `develop` | `develop` |
| `fix/<name>` | Bug fixes | `develop` | `develop` |
| `chore/<name>` | Maintenance, deps, config | `develop` | `develop` |
| `hotfix/vX.Y.Z` | Urgent production fixes | `main` | `main` + `develop` |
| `release/vX.Y.Z` | Release preparation | `develop` | `main` + `develop` |

### Rules

- Never commit directly to `main` or `develop`
- All work goes through a branch and a PR
- Delete branches after merging
- Hotfixes merge into both `main` and `develop`
- Release branches merge into both `main` and `develop`

## Branch Naming

```
type/short-description
```

Types: `feature`, `fix`, `chore`, `hotfix`, `release`

Examples:

```
feature/context-monitor
fix/push-protection-test-values
chore/update-dependencies
hotfix/v0.2.1
release/v0.3.0
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

- Feature/fix/chore branches: squash merge into `develop`
- Release branches: merge commit into `main` (preserves release history)
- Hotfix branches: merge commit into both `main` and `develop`

## Release Flow

1. Branch `release/vX.Y.Z` from `develop`
2. Update `CHANGELOG.md` and `package.json` version
3. PR into `main`, merge
4. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. GitHub Actions creates the release automatically
6. Publish: `npm publish` (or `npm publish --tag beta`)
7. Merge `main` back into `develop`

## Tagging

- Tags follow semver: `vMAJOR.MINOR.PATCH`
- Pre-release tags: `vMAJOR.MINOR.PATCH-beta.N`
- Tag after merging to `main`, before npm publish — always
- Pushing a tag triggers the GitHub Actions release workflow
