## Summary

<!-- What does this PR do? One paragraph. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] New board support
- [ ] Documentation update
- [ ] Refactor (no behaviour change)

## Checklist

- [ ] Unit tests added or updated (`test/unit/`)
- [ ] Fixtures added if new board or new API response shape (`test/fixtures/`)
- [ ] Shell scripts are POSIX-compliant (`#!/usr/bin/env bash`, `set -euo pipefail`)
- [ ] `boards.json` updated if adding a board (with `author` and `url` — required)
- [ ] CHANGELOG.md updated
- [ ] README.md updated if commands or workflow changed

## New board checklist (if applicable)

- [ ] `src/templates/scripts/clancy-once-{board}.sh` created
- [ ] `registry/boards.json` entry added (with `author` and `url`)
- [ ] `.env.example.{board}` created in `src/templates/`
- [ ] Fixtures: `test/fixtures/{board}-happy-path.json`, `{board}-empty.json`, `{board}-auth-failure.json`
- [ ] Unit tests: `test/unit/{board}.test.sh`
- [ ] `test/README.md` updated with fixture descriptions

## Testing

<!-- How did you test this? What commands did you run? -->

## Related issues

<!-- Closes #N -->
