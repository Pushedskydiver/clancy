# Security

## Permissions model

Clancy runs Claude with `--dangerously-skip-permissions`, which suppresses all permission prompts so it can work unattended. This means Claude has full read/write access to your file system and can execute shell commands without asking.

**Only run Clancy on codebases you own and trust.** Review the scripts in `.clancy/` before your first run if you want to see exactly what executes.

**Alternative — granular permissions:** if you run Claude Code without `--dangerously-skip-permissions` by default, you can pre-approve only the commands Clancy needs. Add this to `.claude/settings.json` in your project (or `~/.claude/settings.json` globally):

```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(bash:*)",
      "Bash(node:*)",
      "Bash(npm:*)",
      "Bash(mkdir:*)",
      "Bash(cat:*)",
      "Bash(cp:*)",
      "Bash(echo:*)",
      "Bash(ls:*)",
      "Bash(grep:*)",
      "Bash(wc:*)",
      "Bash(sort:*)",
      "Bash(tr:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(lsof:*)",
      "Bash(command:*)"
    ]
  }
}
```

## Protect your credentials from Claude

Your board tokens and API keys live in `.clancy/.env`. Although Claude doesn't need to read this file during a run (the JS shim loads it before invoking Claude), adding it to Claude Code's deny list is good defence-in-depth. Add it to `.claude/settings.json` in your project, or `~/.claude/settings.json` globally:

```json
{
  "permissions": {
    "deny": [
      "Read(.clancy/.env)",
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)"
    ]
  }
}
```

This prevents Claude from reading these files regardless of what commands run. Clancy automatically adds `.clancy/.env` to `.gitignore` during init, but the deny list is an additional layer.

## Credential guard

Clancy installs a `PreToolUse` hook (`clancy-credential-guard.js`) that scans every Write, Edit, and MultiEdit operation for credential patterns — API keys, tokens, passwords, private keys, and connection strings. If a match is found, the operation is blocked with a message telling Claude to move the credential to `.clancy/.env` instead. Files that are expected to contain credentials (`.clancy/.env`, `.env.example`, etc.) are exempt.

This is best-effort — it won't catch every possible credential format, but it prevents the most common accidental leaks.

## Token scopes

Use the minimum permissions each integration requires:

| Integration | Recommended scope |
|---|---|
| GitHub PAT | `repo` scope (classic PATs) or Metadata read + Issues read/write (fine-grained PATs). Both types are supported. |
| Jira API token | Standard user — no admin rights needed |
| Linear API key | Personal API key — read/write to your assigned issues |
| Figma API key | Read-only access is sufficient |

## Webhook URLs

If you configure Slack or Teams notifications, treat the webhook URL as a secret — anyone who has it can post to your channel. Keep `.clancy/.env` gitignored (Clancy does this automatically during init) and never share the URL.

## Reporting vulnerabilities

Please use GitHub's private vulnerability reporting to disclose security issues. Do not open a public issue.
