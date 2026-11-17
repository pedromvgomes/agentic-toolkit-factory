---
about: "source/factory/main.go"
saw:
  - "go.vipengele.org/cli/core@v0.1.0 app.go, the App's doc comment on the version command"
---

`newApp` in `main.go` adds only `run`. The cli/core App owns the `version` command, including
`version --json`, and a command of that name added by the tool makes the command tree invalid.
The version it prints comes from the framework's buildinfo, so there is no `-X main.version`
variable to set at build time; `main_test.go` fixes it with `cli.WithBuildInfo` so the asserted
string is the same under `go run`, `go build` and CI.
