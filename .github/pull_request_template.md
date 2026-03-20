## Summary

<!-- What does this PR do? One paragraph. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] New board support
- [ ] Documentation update
- [ ] Refactor (no behaviour change)

## Checklist

- [ ] Unit tests added or updated (co-located `<name>.test.ts`)
- [ ] All tests pass (`npm test && npm run typecheck && npm run lint`)
- [ ] CHANGELOG.md updated
- [ ] README.md test badge updated (if test count changed)
- [ ] Version bump in package.json + package-lock.json synced
- [ ] CLAUDE.md updated (if key paths, technical details, or commands changed)
- [ ] Glossary updated (if new terms introduced)
- [ ] Architecture doc updated (if new modules/phases added)

## New board checklist (if applicable)

- [ ] Board module created in `src/scripts/board/{board}/` with `{board}.ts` + `{board}-board.ts`
- [ ] Implements all 11 Board type methods
- [ ] Zod schema added to `src/schemas/{board}.ts`
- [ ] Env schema in `src/schemas/env.ts` with detection signal
- [ ] Factory case in `src/scripts/board/factory/factory.ts`
- [ ] `.env.example` content in `src/roles/setup/workflows/scaffold.md`
- [ ] Init/settings workflows updated for new board
- [ ] Co-located tests for both raw API and Board wrapper

## Testing

<!-- How did you test this? What commands did you run? -->

## Related issues

<!-- Closes #N -->
