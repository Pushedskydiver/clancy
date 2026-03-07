# Clancy Scaffold Workflow

## Overview

Shared scaffolding logic used during `/clancy:init`. Not a standalone command.

---

## Doc templates

Create these files in `.clancy/docs/` with section headings but no content:

### STACK.md
```markdown
# Stack

## Runtime

## Package Manager

## Frameworks

## Key Libraries

## Build Tools

## Dev Servers

## Environment
```

### INTEGRATIONS.md
```markdown
# Integrations

## External APIs

## Authentication

## Data Storage

## Third-party Services

## Environment Variables Required
```

### ARCHITECTURE.md
```markdown
# Architecture

## Overview

## Directory Structure

## Key Modules

## Data Flow

## API Design

## State Management
```

### CONVENTIONS.md
```markdown
# Conventions

## Code Style

## Naming Conventions

## File Organisation

## Component Patterns

## Error Handling

## Logging
```

### TESTING.md
```markdown
# Testing

## Test Runner

## Test Structure

## Unit Tests

## Integration Tests

## E2E Tests

## Coverage Expectations
```

### GIT.md
```markdown
# Git Conventions

## Branch Naming

## Commit Format

## Merge Strategy

## Pull Request Process

## Versioning
```

### DESIGN-SYSTEM.md
```markdown
# Design System

## Token System

## Component Library

## Theming

## Responsive Breakpoints

## Icon System
```

### ACCESSIBILITY.md
```markdown
# Accessibility

## WCAG Level

## ARIA Patterns

## Keyboard Navigation

## Focus Management

## Screen Reader Support
```

### DEFINITION-OF-DONE.md
```markdown
# Definition of Done

## Code Quality

## Testing

## Documentation

## Design

## Accessibility

## Review
```

### CONCERNS.md
```markdown
# Concerns

## Known Tech Debt

## Security Considerations

## Performance Bottlenecks

## Areas to Avoid Changing

## Deprecated Patterns
```

---

## PLAYWRIGHT.md template

Create `.clancy/docs/PLAYWRIGHT.md` when `PLAYWRIGHT_ENABLED=true`:

```markdown
# Playwright Visual Checks

Clancy runs visual checks after implementing UI tickets. This file defines
which server to use and how to start it.

## Decision Rule

Apply in order:
1. If the ticket mentions: route, page, screen, layout, full-page → use **dev server**
2. If the ticket mentions: component, atom, molecule, organism, variant, story → use **Storybook**
3. Ambiguous → default to **dev server**

## Dev Server

| Key | Value |
|---|---|
| Start command | `{PLAYWRIGHT_DEV_COMMAND}` |
| Port | `{PLAYWRIGHT_DEV_PORT}` |
| Health check | `http://localhost:{PLAYWRIGHT_DEV_PORT}` |
| Startup wait | {PLAYWRIGHT_STARTUP_WAIT}s (use health check polling, not sleep) |

## Storybook

<!-- Remove this section if Storybook is not used -->

| Key | Value |
|---|---|
| Start command | `{PLAYWRIGHT_STORYBOOK_COMMAND}` |
| Port | `{PLAYWRIGHT_STORYBOOK_PORT}` |
| Story URL pattern | `http://localhost:{PLAYWRIGHT_STORYBOOK_PORT}/?path=/story/{component-name}` |

## Visual Check Process

1. Determine which server to use (decision rule above)
2. Start the server using health check polling — poll every 2s, timeout after {PLAYWRIGHT_STARTUP_WAIT}s
3. Navigate to the relevant route or story URL
4. Screenshot the full page
5. Assess visually — check layout, spacing, colours, responsive behaviour
6. Check browser console for errors
7. Fix anything wrong before committing
8. Kill server by PID, then sweep the port unconditionally
9. Log result: `YYYY-MM-DD HH:MM | TICKET-KEY | PLAYWRIGHT_PASS|FAIL | dev-server|storybook`

## Server Health Check Pattern

```bash
# Start server in background
{PLAYWRIGHT_DEV_COMMAND} &
SERVER_PID=$!

# Poll until ready
MAX_WAIT={PLAYWRIGHT_STARTUP_WAIT}
ELAPSED=0
until curl -s http://localhost:{PLAYWRIGHT_DEV_PORT} >/dev/null 2>&1; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "Server did not start within ${MAX_WAIT}s"
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi
done

# ... run visual check ...

# Cleanup — kill by PID, then sweep port unconditionally
kill $SERVER_PID 2>/dev/null
lsof -ti:{PLAYWRIGHT_DEV_PORT} | xargs kill -9 2>/dev/null || true
```
```

---

## CLAUDE.md merge logic

### If CLAUDE.md does not exist

Write the full template as `CLAUDE.md` (see `src/templates/CLAUDE.md`).

### If CLAUDE.md already exists

Check for existing `<!-- clancy:start -->` marker:
- Found: Replace everything between `<!-- clancy:start -->` and `<!-- clancy:end -->` with updated content
- Not found: Append the Clancy section to the end of the file

Never overwrite the entire file. Always preserve existing content.

---

## .gitignore check

Read the project's `.gitignore`. If `.env` is not present, append:
```
# Clancy credentials
.env
```

If no `.gitignore` exists, create one with:
```
# Environment
.env

# Dependencies
node_modules/

# OS
.DS_Store
```
