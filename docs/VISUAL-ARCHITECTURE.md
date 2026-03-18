# Clancy — Visual Architecture

Interactive diagrams showing how roles, commands, and flows connect. Rendered natively by GitHub.

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

    style SETUP fill:#e8f5e9,stroke:#2e7d32
    style STRATEGIST fill:#fff3e0,stroke:#e65100
    style PLANNER fill:#e3f2fd,stroke:#1565c0
    style IMPLEMENTER fill:#fce4ec,stroke:#c62828
    style REVIEWER fill:#f3e5f5,stroke:#6a1b9a
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
        Deliver --> EpicMerge: Has parent?
        Deliver --> PRFlow: No parent?
        EpicMerge --> Done: Squash merge + transition
        PRFlow --> PRCreated: Push + create PR
        PRCreated --> Rework: Review feedback?
        Rework --> PRCreated: Push fixes
        PRCreated --> Done: Approved + merged
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
    Start(["/clancy:once"]) --> Preflight

    subgraph Preflight
        P1[".clancy/.env exists?"] -->|No| Stop1["Run /clancy:init first ✗"]
        P1 -->|Yes| P2["Parse env, detect board"]
        P2 --> P3["Ping board credentials"]
        P3 -->|Fail| Stop2["Check credentials ✗"]
        P3 -->|OK| P4["Git connectivity check"]
        P4 --> P5["Branch freshness check"]
    end

    P5 --> FetchTicket

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

    InvokeClaude -->|Success| HasParent{"Has parent\n(epic/milestone)?"}
    InvokeClaude -->|Fail| Stop6["Claude session failed ✗"]

    HasParent -->|Yes| EpicMerge["Squash merge → main\nDelete feature branch\nTransition → Done"]
    HasParent -->|No| PRCreate["Push feature branch\nCreate PR/MR\nTransition → Review"]

    EpicMerge --> Log["Log to progress.txt"]
    PRCreate --> Log

    Log --> Notify["Send notification\n(webhook, if configured)"]
    Notify --> End(["Done"])

    style Stop1 fill:#ffcdd2
    style Stop2 fill:#ffcdd2
    style Stop3 fill:#fff9c4
    style Stop4 fill:#e3f2fd
    style Stop5 fill:#fff9c4
    style Stop6 fill:#ffcdd2
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

    Create["Create tickets on board\n(sequential, 500ms delay)\nLabels: clancy:afk / clancy:hitl"]
    Create --> Link["Link dependencies\n(blocking relationships)"]
    Link --> MarkApproved["Mark brief .approved"]
    MarkApproved --> Summary["Display summary\n→ Next: /clancy:plan"]

    style Skip fill:#fff9c4
    style Cancel fill:#ffcdd2
    style AIGrill fill:#e3f2fd
    style HumanGrill fill:#e8f5e9
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

    style env fill:#fff3e0
    style progress fill:#e8f5e9
    style oncejs fill:#fce4ec
    style afkjs fill:#fce4ec
```

---

## 7. Delivery Paths — Epic Merge vs PR Flow

The two delivery paths determined by whether the ticket has a parent.

```mermaid
flowchart LR
    Claude["Claude commits code"] --> Check{"Has parent\n(epic/milestone)?"}

    Check -->|Yes| Epic["Epic Merge Path"]
    Check -->|No| PR["PR-Based Path"]

    subgraph Epic["Epic Merge Path"]
        E1["Squash merge\nfeature → main"] --> E2["Delete feature\nbranch"]
        E2 --> E3["Transition ticket\n→ Done"]
        E3 --> E4["Log: DONE"]
    end

    subgraph PR["PR-Based Path"]
        P1["Push feature\nbranch"] --> P2["Create PR/MR\n(GitHub/GitLab/Bitbucket)"]
        P2 --> P3["Transition ticket\n→ Review"]
        P3 --> P4["Log: PR_CREATED"]
        P4 --> P5{"Review\nfeedback?"}
        P5 -->|Yes| P6["Fetch comments\nBuild rework prompt"]
        P6 --> P7["Re-invoke Claude\nPush fixes"]
        P7 --> P8["Post rework comment\nRe-request review"]
        P8 --> P5
        P5 -->|"No (approved)"| P9["Merge PR\nTransition → Done"]
    end

    style Epic fill:#e8f5e9
    style PR fill:#e3f2fd
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

    style TDDBlock fill:#e3f2fd
    style RTDDBlock fill:#e3f2fd
```
