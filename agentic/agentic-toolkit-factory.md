# agentic-toolkit-factory

The **Factory** for agentic-toolkit runs agentic-toolkit's Workflow Definitions as Workflow
Executions: one container per Execution, supervised by a Durable Object, with a fixed number
running at once. Its first Workflow, "implement backlog item", takes a **Backlog item** from
`agtk:queued` to an open pull request without a person starting it. Around the Executions the
Factory keeps the **Backlog** moving: it unblocks items whose **Predecessor**s are done and
sweeps stalled items back to the queue.

Read `CONTEXT.md` before naming anything. Its terms (Backlog, Backlog item, Stub, Feature,
Factory, Dispatcher, Factory App, Predecessor) are copied from agentic-toolkit's `CONTEXT.md`,
which stays authoritative: a definition changes there first and is copied back here, never
redefined in this repo.

## Boundaries

- The Factory acts as the **Factory App**: issue permissions only, no access to code. Nothing
  here asks the Factory App for a code-scoped token. Work that needs code runs with a
  per-Execution installation token of a second, code-capable GitHub App, narrowed to one
  repository and to the registration's permission ceiling, and never placed in the container
  (`docs/adr/0003-*`).
- A Backlog item's body is the work; its comments are never read as instructions.
- The Factory applies `agtk:queued` only to release an item from `agtk:blocked` whose
  Predecessors are all closed as completed, and only as the Factory App. It never queues an item
  that is a stub or that no person has queued or released before. A person with write access
  queuing an item is what first vouches for its body. An Execution of the "implement backlog
  item" Workflow dispatches an item only after `agtk backlog verify` trusts it: every author and
  editor of the body has write access, and nobody edited it after it was queued or released, so
  a release never vouches for a body a person has not read.

## Layout

- `source/<project>/` — all code. Each project is its own Go module with its own `go.mod`,
  module path `github.com/pedromvgomes/agentic-toolkit-factory/source/<project>`. Nothing builds
  at the repo root.
- `source/factory/` — the Factory's command, `agtk-factory`, a CLI built on `go.vipengele.org/cli`
  (`core` and `spec`). `run <definition>` takes a Workflow Definition and returns an error because
  the Factory has no engine to execute one; `version` (`--json`) comes from the framework. The
  `run` command lives in `internal/command/run`, and its tests go through `ExecuteArgs`.
- `spikes/<name>/` — throwaway experiments, not projects: outside `source/`, outside every lydite
  component, not built by CI.
- `CONTEXT.md` — the glossary.
- `README.md` — the architecture: components and one Workflow Execution, as diagrams.
- `docs/adr/` — the decision records.
- `.gt-repo.yaml` — repository governance; run `gt repo sync` after editing it. The
  `ci-*.yml` stage workflows belong to this repo; gt writes the orchestration around them.
- `.lydite/` — what lydite builds, tests, scans and gates: one component per project.
- `.memory/` — the repo-resident memory store (see the memory-first exploration instruction).

## Commands (run from `source/<project>`)

```bash
go build ./...
go vet ./...
go test -race -shuffle=on ./...
gofmt -l .            # prints files gofmt would change; CI fails on any output
golangci-lint run     # v2, the version pinned in .github/workflows/ci-build.yml
go mod tidy           # CI fails when this changes go.mod or go.sum
```

## Adding a project

A new project under `source/` needs a component in `.lydite/components.yml`, a `gomod` entry in
`.gt-repo.yaml` followed by `gt repo sync`, and its name in the `matrix.project` lists of
`ci-build.yml` and `ci-test.yml`.
