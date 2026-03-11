## Summary

<!-- What does this PR do? One paragraph. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] New board support
- [ ] Documentation update
- [ ] Refactor (no behaviour change)

## Checklist

- [ ] Unit tests added or updated
- [ ] Fixtures added if new board or new API response shape (`test/fixtures/`)
- [ ] `boards.json` updated if adding a board (with `author` and `url` — required)
- [ ] CHANGELOG.md updated
- [ ] README.md updated if commands or workflow changed

## New board checklist (if applicable)

- [ ] TypeScript module created in `src/scripts/shared/boards/{board}/`
- [ ] Env schema added to `src/scripts/shared/env-schema/`
- [ ] `registry/boards.json` entry added (with `author` and `url`)
- [ ] `.env.example` content added to `src/workflows/scaffold.md`
- [ ] Fixtures: `test/fixtures/{board}-happy-path.json`, `{board}-empty.json`, `{board}-auth-failure.json`
- [ ] Co-located unit tests
- [ ] `test/README.md` updated with fixture descriptions

## Testing

<!-- How did you test this? What commands did you run? -->

## Related issues

<!-- Closes #N -->
