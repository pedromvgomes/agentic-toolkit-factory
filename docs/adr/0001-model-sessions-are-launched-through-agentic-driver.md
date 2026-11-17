# Model sessions are launched through agentic-driver

## Context

A Workflow Execution's agentic steps run a model session: Claude Code or Codex, headless, inside
the Execution's container. Something has to assemble each CLI's arguments, apply a timeout, read
its exit code, redact its stderr and build its credentials in isolation, for every provider the
Factory supports.

`agtk` is installed in the same image and already knows how to reach these CLIs for
`agtk memory curate`. agentic-toolkit ADR-0002 keeps model calls off the path of `agtk`'s
deterministic commands, and the single subcommand that does invoke an agent does it through
`github.com/pedromvgomes/agentic-driver`, whose `claudecode` and `codex` providers own that
dialect knowledge.

## Decision

`agtk-factory` launches every model session itself, through
`github.com/pedromvgomes/agentic-driver`. Its agentic steps name a provider; the driver turns that
into the CLI invocation. `agtk` never launches a model session on the Factory's behalf: the
Factory calls it only for deterministic work such as `agtk backlog verify`.

## Rejected alternatives

**Run the session through `agtk`.** A Factory session needs a command that runs an arbitrary
prompt, and such a command puts model calls on the binary that agentic-toolkit ADR-0002 keeps
deterministic for hooks and CI.

**Shell out to each CLI with a command string.** A raw command cannot express timeouts, exit-code
handling, stderr redaction or isolated credential construction, so each would be re-implemented
here, and worse, beside the provider abstraction the driver already tests.

## Consequences

- A CLI the Factory needs and the driver has no provider for is a gap filled in
  agentic-driver, not a special case in this repository.
- The Factory and `agtk memory curate` share one provider implementation, so a CLI's change of
  flags or output is fixed once.
- `agtk-factory` depends on an agentic-driver release; the version in `source/factory/go.mod` is
  the version every agentic step runs with.
