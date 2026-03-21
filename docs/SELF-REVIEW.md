# Self-Review Checklist

Line-level accuracy check performed after DA review but before creating a PR. Read every changed file (`git diff main...HEAD`) and check for detail-level issues that DA and doc agents miss.

This is a **living document** — when Copilot catches something the self-review should have spotted, add the specific check here immediately. The checklist grows from real mistakes, not hypotheticals.

---

## Code accuracy

- Do comments/JSDoc match what the code actually does? (stale comments are the #1 review catch)
- Do comments hardcode counts, versions, or phase numbers that will go stale? Use generic language instead (e.g. "full pipeline" not "13-phase pipeline")
- Are all function parameters used? If not, remove or use them
- Do mock/test URLs match the actual production endpoints? (read the production code to verify)
- Do fixture shapes match what the production code expects? (check Zod schemas and actual API calls)

## Consistency

- Are constants duplicated across files? (single source of truth)
- Are imports unused?
- Do config options extend defaults rather than replacing them?
- Was the same fix applied everywhere it's needed? (don't fix helpers but miss test files)
- Do any imported modules cache global state that could leak between tests? (reset caches in `afterEach`)
- Do test assertions use full expected values, not ambiguous substrings? (e.g. `'notion-ab12cd34'` not just `'ab12cd34'`)
- Are module-scoped mutable variables (e.g. mock implementations) reset in `afterEach`? (prevents one test's setup leaking into the next)
- Do docs reference files that only exist in memory (`~/.claude/projects/`) but not in the repo? Contributors can't see memory files

## Security / robustness

- Is `execSync` used with string interpolation? (use `execFileSync` with argument arrays)
- Are test credential values constructed at runtime where needed? (GitHub secret scanner)

## Config inheritance

- Did changing a config file affect other configs that extend it? (e.g. `tsconfig.build.json` extends `tsconfig.json` — changing `rootDir` in the base breaks the build output paths)
