# Clancy — Visual Architecture

Interactive diagrams showing how roles, commands, and flows connect. Rendered natively by GitHub.

## Table of Contents

1. [Role & Command Map](#1-role--command-map) — all 5 roles and their 17 commands
2. [Ticket Lifecycle](#2-ticket-lifecycle--end-to-end) — state machine from idea to merged code
3. [Once Orchestrator](#3-the-once-orchestrator--implementation-flow) — what happens inside `/clancy:once`
4. [Strategist Flow](#4-strategist-flow--brief-to-tickets-v060) — `/clancy:brief` and `/clancy:approve-brief`
5. [Board API Matrix](#5-board-api-interaction-matrix) — which commands talk to which APIs
6. [File Artifacts](#6-file-artifacts--what-lives-in-clancy) — everything in `.clancy/`
7. [Delivery Paths](#7-delivery-paths--pr-flow-with-epic-branches) — PR flow with epic branches
8. [Prompt Building](#8-prompt-building--what-claude-receives) — what Claude gets for implementation and rework

---

## 1. Role & Command Map

Every command organised by role. Core roles are always installed; optional roles opt-in via `CLANCY_ROLES`.

```mermaid
graph TB
    subgraph SETUP["Setup & Maintenance (core)"]
        init["/clancy:init"]
        settings["/clancy:settings"]
        doctor["/clancy:doctor"]
        mapcb["/clancy:map-codebase"]
        updatedocs["/clancy:update-docs"]
        update["/clancy:update"]
        uninstall["/clancy:uninstall"]
        help["/clancy:help"]
    end

    subgraph STRATEGIST["Strategist (optional, v0.6.0)"]
        brief["/clancy:brief"]
        approvebrief["/clancy:approve-brief"]
    end

    subgraph PLANNER["Planner (optional)"]
        plan["/clancy:plan"]
        approveplan["/clancy:approve-plan"]
    end

    subgraph IMPLEMENTER["Implementer (core)"]
        once["/clancy:once"]
        run["/clancy:run"]
        dryrun["/clancy:dry-run"]
    end

    subgraph REVIEWER["Reviewer (core)"]
        review["/clancy:review"]
        status["/clancy:status"]
        logs["/clancy:logs"]
    end

    init -->|scaffolds .clancy/| mapcb
    mapcb -->|generates docs| brief
    brief -->|produces brief| approvebrief
    approvebrief -->|creates tickets| plan
    plan -->|produces plan| approveplan
    approveplan -->|promotes to impl queue| once
    once -->|implements ticket| review
    run -->|loops once| once
    review -->|scores implementation| logs

    style SETUP stroke:#2e7d32,stroke-width:2px
    style STRATEGIST stroke:#e65100,stroke-width:2px
    style PLANNER stroke:#1565c0,stroke-width:2px
    style IMPLEMENTER stroke:#c62828,stroke-width:2px
    style REVIEWER stroke:#6a1b9a,stroke-width:2px
```

---

## 2. Ticket Lifecycle — End to End

A ticket's complete journey from vague idea to merged code. The strategist and planner are optional — tickets can enter the implementer queue directly.

```mermaid
stateDiagram-v2
    [*] --> Idea: Vague idea on board\nor inline text

    state "Strategist (optional)" as strat {
        Idea --> Grill: /clancy:brief
        Grill --> Brief: Generate brief
        Brief --> ReviewBrief: PO reviews
        ReviewBrief --> Brief: Feedback → revise
        ReviewBrief --> Tickets: /clancy:approve-brief
    }

    state "Planner (optional)" as plnr {
        Tickets --> Backlog: Tickets in backlog
        Backlog --> Planning: /clancy:plan
        Planning --> ReviewPlan: PO reviews plan
        ReviewPlan --> Planning: Feedback → revise
        ReviewPlan --> Ready: /clancy:approve-plan
    }

    state "Implementer" as impl {
        Ready --> InProgress: /clancy:once or /clancy:run
        InProgress --> Claude: Invoke Claude session
        Claude --> Deliver: Code committed
    }

    state "Delivery" as deliv {
        Deliver --> PRCreated: Push + create PR
        PRCreated --> Rework: Review feedback?
        Rework --> PRCreated: Push fixes
        PRCreated --> ChildDone: Approved + merged
    }

    state "Epic Completion" as epic {
        ChildDone --> EpicCheck: Has parent?
        ChildDone --> Done: No parent
        EpicCheck --> EpicPR: All children done?
        EpicCheck --> Done: More children remain
        EpicPR --> Done: Epic PR approved + merged
    }

    Done --> [*]

    note right of Grill
        Human grill (interactive)
        or AI-grill (--afk)
    end note

    note right of Rework
        Max 3 cycles
        then human intervention
    end note
```

---

## 3. The Once Orchestrator — Implementation Flow

What happens inside `/clancy:once` (and each iteration of `/clancy:run`).

```mermaid
flowchart TD
    Start(["/clancy:once"]) --> LockCheck

    LockCheck{"Lock file\nexists?"} -->|No| AcquireLock["Acquire lock\n(.clancy/lock.json)"]
    LockCheck -->|"Yes — PID alive"| Stop0["Another session running ✗"]
    LockCheck -->|"Yes — PID dead"| Resume["Resume crashed session\n(read ticket + branch from lock)"]

    AcquireLock --> Preflight
    Resume --> Branch

    subgraph Preflight
        P1[".clancy/.env exists?"] -->|No| Stop1["Run /clancy:init first ✗"]
        P1 -->|Yes| P2["Parse env, detect board"]
        P2 --> P3["Ping board credentials"]
        P3 -->|Fail| Stop2["Check credentials ✗"]
        P3 -->|OK| P4["Git connectivity check"]
        P4 --> P5["Branch freshness check"]
    end

    P5 --> EpicScan

    EpicScan["Epic completion scan\n(check if any epics have\nall children done → create\nepic PR if so)"] --> FetchTicket

    subgraph FetchTicket["Fetch Ticket"]
        F1["Query board for next ticket"] -->|None found| Stop3["No tickets — all done"]
        F1 -->|Found| F2["Check for rework\n(scan progress.txt)"]
        F2 -->|PR has feedback| Rework["Build rework prompt"]
        F2 -->|No rework| F3["Fresh ticket"]
    end

    F3 --> DryRun
    Rework --> DryRun

    DryRun{"--dry-run?"} -->|Yes| Stop4["Preview shown, no changes"]
    DryRun -->|No| Feasibility

    Feasibility["Feasibility check\n(can this be a code change?)"] -->|Skip| Stop5["⚠ Skipping — not code work"]
    Feasibility -->|OK| Branch

    Branch["Create/checkout\nfeature branch"] --> Transition["Transition → In Progress"]
    Transition --> BuildPrompt

    BuildPrompt["Build prompt\n(ticket + docs + TDD?)"] --> InvokeClaude["Invoke Claude session\n(claude -p --dangerously-skip-permissions)"]

    InvokeClaude -->|Success| VerifyGate
    InvokeClaude -->|Fail| Stop6["Claude session failed ✗"]

    subgraph VerifyGate["Verification Gate"]
        V1["Run lint/test/typecheck"] -->|Pass| VPass["Checks passed ✓"]
        V1 -->|Fail| V2{"Retries\nremaining?"}
        V2 -->|Yes| V3["Self-healing fix\n(feed errors to Claude)"]
        V3 --> V1
        V2 -->|No| VWarn["Deliver with\nverification warning"]
    end

    VPass --> PRDeliver["Push feature branch\nCreate PR/MR\nTransition → Review"]
    VWarn --> PRDeliver

    PRDeliver --> Log["Log to progress.txt"]
    Log --> Cost["Cost log\n(.clancy/costs.log)"]
    Cost --> ReleaseLock["Release lock file"]

    ReleaseLock --> Notify["Send notification\n(webhook, if configured)"]
    Notify --> End(["Done"])

    style Stop0 stroke:#c62828,stroke-width:2px
    style Stop1 stroke:#c62828,stroke-width:2px
    style Stop2 stroke:#c62828,stroke-width:2px
    style Stop3 stroke:#f9a825,stroke-width:2px
    style Stop4 stroke:#1565c0,stroke-width:2px
    style Stop5 stroke:#f9a825,stroke-width:2px
    style Stop6 stroke:#c62828,stroke-width:2px
    style VerifyGate stroke:#2e7d32,stroke-width:2px
```

---

## 4. Strategist Flow — Brief to Tickets (v0.6.0)

The strategist's two commands: `/clancy:brief` (idea → brief) and `/clancy:approve-brief` (brief → board tickets).

```mermaid
flowchart TD
    Start(["/clancy:brief"]) --> Input["Parse input\n(ticket / text / file / interactive)"]

    Input --> GrillMode{"Grill mode?"}
    GrillMode -->|"--afk or CLANCY_MODE=afk"| AIGrill["AI-Grill\nDevil's advocate agent\n(codebase + board + web)"]
    GrillMode -->|Interactive| HumanGrill["Human Grill\nMulti-round Q&A\n(2-5 rounds)"]

    AIGrill --> Discovery["## Discovery\n(source-tagged Q&A)"]
    HumanGrill --> Discovery

    Discovery --> Relevance{"Relevant to\ncodebase?"}
    Relevance -->|No| Skip["⚠ Skipping — wrong stack"]
    Relevance -->|Yes| Research

    Research["Adaptive research\n1-4 agents\n(codebase + web)"] --> Generate["Generate brief\n(template + decomposition)"]

    Generate --> Save["Save to\n.clancy/briefs/"]
    Save --> PostBoard{"Board-sourced?"}
    PostBoard -->|Yes| Comment["Post as comment\non source ticket"]
    PostBoard -->|No| Display
    Comment --> Display["Display brief\n+ next steps"]

    Display --> ReviewLoop{"PO feedback?"}
    ReviewLoop -->|Yes| Revise["Re-run /clancy:brief\n(auto-detect feedback)"]
    Revise --> Discovery
    ReviewLoop -->|No| Approve

    Approve(["/clancy:approve-brief"]) --> Parse["Parse decomposition\ntable from brief"]
    Parse --> Topo["Topological sort\n(dependency order)"]
    Topo --> Confirm["Confirm with user\n(show HITL/AFK breakdown)"]
    Confirm -->|No| Cancel["Cancelled"]
    Confirm -->|Yes| Create

    Create["Create tickets on board\n(sequential, 500ms delay)\nLabels: clancy:afk / clancy:hitl\nDescription includes Epic: {key}"]
    Create --> Link["Link dependencies\n(blocking relationships)"]
    Link --> MarkApproved["Mark brief .approved"]
    MarkApproved --> Summary["Display summary\n→ Next: /clancy:plan"]

    style Skip stroke:#f9a825,stroke-width:2px
    style Cancel stroke:#c62828,stroke-width:2px
    style AIGrill stroke:#1565c0,stroke-width:2px
    style HumanGrill stroke:#2e7d32,stroke-width:2px
```

---

## 5. Board API Interaction Matrix

Which commands talk to which board APIs, and what operations they perform.

```mermaid
graph LR
    subgraph Commands
        brief["/clancy:brief"]
        approvebrief["/clancy:approve-brief"]
        plan["/clancy:plan"]
        approveplan["/clancy:approve-plan"]
        once["/clancy:once"]
        status["/clancy:status"]
    end

    subgraph Operations
        fetch["Fetch tickets"]
        create["Create tickets"]
        transition["Transition status"]
        comment["Post comment"]
        link["Link dependencies"]
        close["Close / Done"]
    end

    subgraph Boards
        jira[(Jira Cloud)]
        github[(GitHub Issues)]
        linear[(Linear)]
    end

    brief --> fetch
    brief --> comment
    approvebrief --> create
    approvebrief --> link
    approvebrief --> comment
    plan --> fetch
    plan --> comment
    approveplan --> fetch
    approveplan --> transition
    once --> fetch
    once --> transition
    once --> close
    status --> fetch

    fetch --> jira
    fetch --> github
    fetch --> linear
    create --> jira
    create --> github
    create --> linear
    transition --> jira
    transition --> linear
    comment --> jira
    comment --> github
    comment --> linear
    link --> jira
    link --> linear
    close --> jira
    close --> github
    close --> linear

    style jira fill:#0052CC,color:#fff
    style github fill:#24292e,color:#fff
    style linear fill:#5E6AD2,color:#fff
```

---

## 6. File Artifacts — What Lives in `.clancy/`

Everything Clancy creates and reads in the user's project.

```mermaid
graph TD
    subgraph ".clancy/"
        env[".env\n(board credentials + config)"]
        oncejs["clancy-once.js\n(esbuild bundle)"]
        afkjs["clancy-afk.js\n(esbuild bundle)"]
        pkg["package.json\n({'type':'module'})"]
        progress["progress.txt\n(run log)"]
        costslog["costs.log\n(token cost estimates)"]
        lockfile["lock.json\n(crash recovery)"]
        sessionrpt["session-report.md\n(AFK summary)"]
        claudemd["CLAUDE.md\n(project instructions)"]

        subgraph "docs/"
            stack["STACK.md"]
            arch["ARCHITECTURE.md"]
            conv["CONVENTIONS.md"]
            test["TESTING.md"]
            dod["DEFINITION-OF-DONE.md"]
            design["DESIGN-SYSTEM.md"]
            a11y["ACCESSIBILITY.md"]
        end

        subgraph "briefs/ (v0.6.0)"
            brief1["2026-03-18-dark-mode.md"]
            brief1a[".approved marker"]
            brief2["2026-03-17-auth-rework.md"]
            feedback["...feedback.md\n(companion file)"]
        end
    end

    init(["/clancy:init"]) -->|creates| env
    init -->|copies| oncejs
    init -->|copies| afkjs
    init -->|writes| pkg

    mapcb(["/clancy:map-codebase"]) -->|generates| stack
    mapcb -->|generates| arch
    mapcb -->|generates| conv
    mapcb -->|generates| test

    brief(["/clancy:brief"]) -->|writes| brief1
    approvebrief(["/clancy:approve-brief"]) -->|writes| brief1a

    once(["/clancy:once"]) -->|reads| env
    once -->|reads| stack
    once -->|appends| progress
    once -->|executes| oncejs

    logs(["/clancy:logs"]) -->|reads| progress

    style env stroke:#e65100,stroke-width:2px
    style progress stroke:#2e7d32,stroke-width:2px
    style oncejs stroke:#c62828,stroke-width:2px
    style afkjs stroke:#c62828,stroke-width:2px
```

---

## 7. Delivery Paths — PR Flow with Epic Branches

All tickets are delivered via PR. The target branch depends on whether the ticket has a parent.

```mermaid
flowchart LR
    Claude["Claude commits code"] --> Push["Push feature branch"]
    Push --> PR["Create PR/MR"]

    PR --> Target{"PR target?"}

    Target -->|"Has parent"| EpicBranch["PR targets\nepic branch"]
    Target -->|"No parent"| BaseBranch["PR targets\nbase branch"]

    subgraph ChildFlow["Child Ticket Flow"]
        EpicBranch --> Review1["Reviewer reviews\nchild PR"]
        Review1 --> Rework1{"Feedback?"}
        Rework1 -->|Yes| Fix1["Rework fixes\npushed"]
        Fix1 --> Review1
        Rework1 -->|No| Merge1["Merge into\nepic branch"]
        Merge1 --> EpicCheck{"All children\ndone?"}
        EpicCheck -->|No| Done1["Log: PR_CREATED\n(more children remain)"]
        EpicCheck -->|Yes| EpicPR["Create epic PR\nepic → base branch"]
        EpicPR --> Review2["Reviewer reviews\ncomplete feature"]
        Review2 --> Done2["Merge epic PR\n→ Done"]
    end

    subgraph StandaloneFlow["Standalone Ticket Flow"]
        BaseBranch --> Review3["Reviewer reviews PR"]
        Review3 --> Rework2{"Feedback?"}
        Rework2 -->|Yes| Fix2["Rework fixes\npushed"]
        Fix2 --> Review3
        Rework2 -->|No| Done3["Merge PR\n→ Done"]
    end

    style ChildFlow stroke:#1565c0,stroke-width:2px
    style StandaloneFlow stroke:#2e7d32,stroke-width:2px
```

---

## 8. Prompt Building — What Claude Receives

The complete prompt structure for implementation and rework.

```mermaid
graph TD
    subgraph "Implementation Prompt"
        Header["You are implementing {ticket}"]
        Context["Ticket: key, title, description\nEpic/Parent | Blockers"]
        Exec["Step 0: Executability check\n(skip if not code work)"]
        TDD{"CLANCY_TDD\nenabled?"}
        TDD -->|Yes| TDDBlock["## TDD\nRed-green-refactor cycle"]
        TDD -->|No| Steps
        TDDBlock --> Steps
        Steps["1. Read .clancy/docs/\n2. Follow GIT.md\n3. Implement fully\n4. Commit\n5. Confirm done"]
    end

    subgraph "Rework Prompt"
        RHeader["You are fixing feedback on {ticket}"]
        RContext["Description + previous diff"]
        RFeedback["## Reviewer Feedback\n1. Issue A\n2. Issue B"]
        RTDD{"CLANCY_TDD?"}
        RTDD -->|Yes| RTDDBlock["## TDD"]
        RTDD -->|No| RSteps
        RTDDBlock --> RSteps
        RSteps["1. Read docs\n2. Follow GIT.md\n3. Fix feedback only\n4. Commit\n5. Confirm done"]
    end

    Header --> Context --> Exec --> TDD
    RHeader --> RContext --> RFeedback --> RTDD

    style TDDBlock stroke:#1565c0,stroke-width:2px
    style RTDDBlock stroke:#1565c0,stroke-width:2px
```
