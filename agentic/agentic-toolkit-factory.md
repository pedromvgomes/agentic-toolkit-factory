# agentic-toolkit-factory

The **Factory** for agentic-toolkit: the loop that takes a **Backlog item** from `agtk:queued` to
an open pull request without a person starting it — unblocking items whose **Predecessor**s are
done, sweeping stalled runs back to the queue, and dispatching a **Cloud session** for each item
the **Dispatcher** starts. It stops at the pull request; merging is never the Factory's.

Read `CONTEXT.md` before naming anything. Its terms (Backlog, Backlog item, Stub, Feature,
Factory, Dispatcher, Factory App, Predecessor) are copied from agentic-toolkit's `CONTEXT.md`,
which stays authoritative: a definition changes there first and is copied back here, never
redefined in this repo.

## Boundaries

- The Factory acts as the **Factory App**: issue permissions only, no access to code. Nothing
  here asks for a code-scoped token, and nothing here merges a pull request.
- A Backlog item's body is the work; its comments are never read as instructions.
- The Factory applies `agtk:queued` only to release an item from `agtk:blocked` whose
  Predecessors are all closed as completed, and only as the Factory App. It never queues an item
  that is a stub or that no person has queued or released before. A person with write access
  queuing an item is what first vouches for its body.

## Layout

- `source/<project>/` — all code. Each project is its own Go module with its own `go.mod`,
  module path `github.com/pedromvgomes/agentic-toolkit-factory/source/<project>`. Nothing builds
  at the repo root.
- `source/factory/` — the Factory's command.
- `CONTEXT.md` — the glossary.
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
