# agentic-toolkit-factory

The **Factory** that takes [agentic-toolkit](https://github.com/pedromvgomes/agentic-toolkit)
**Backlog item**s from `agtk:queued` to an open pull request without a person starting them.

It unblocks items whose **Predecessor**s have merged, sweeps stalled runs back to the queue, and
dispatches a cloud session for each queued item, up to a fixed number running at once. It acts as
the **Factory App** — issue permissions, no access to code — and stops at the pull request:
merging is never the Factory's.

The vocabulary is agentic-toolkit's; see [CONTEXT.md](CONTEXT.md).

## Develop

The repo is set up with [gt](https://github.com/pedromvgomes/gt) (bare repo + worktrees,
governance in [`.gt-repo.yaml`](.gt-repo.yaml)), [agentic-toolkit](https://github.com/pedromvgomes/agentic-toolkit)
(agent configuration in [`.agentic-toolkit.yaml`](.agentic-toolkit.yaml), rendered by
`agtk render`) and [lydite](https://github.com/lydite/lydite) (scanning, tests and coverage
gates declared in [`.lydite/`](.lydite/)).

All code lives under `source/`, one Go module per project; the Factory itself is
[`source/factory`](source/factory).

```sh
gt clone pedromvgomes/agentic-toolkit-factory   # runs agtk sync through .gt.yaml
cd source/factory && go test -race ./...
lydite scan --dir .
lydite test --dir .
```

## Licence

[MIT](LICENSE)
