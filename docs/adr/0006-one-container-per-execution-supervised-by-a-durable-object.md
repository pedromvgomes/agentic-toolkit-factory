# One container per Execution, supervised by a Durable Object

## Context

A Workflow Execution is a sequence of steps, some deterministic and some model sessions, that can
run for a long time, can be cancelled, and can be interrupted. The Factory needs somewhere to run
the engine, something that outlives the container to hold the Execution's state, and a way to
keep model providers from being driven past what their accounts allow.

## Decision

Each Execution runs in its own container with the hatua engine inside it. Deterministic steps run
in the engine's process. Only agentic steps start a model CLI.

A Durable Object supervises the Executions. It queues them, starts them, cancels them, caps the
number running at once at 3, and stops an Execution when its outcome is reached. The engine in
the container reports to it through a reserved internal host, which the Outbound Worker
intercepts; the container has no other path to the Durable Object.

The model session shares the container with the engine and reads untrusted text, so it can reach
the reserved host too. The Outbound Worker therefore binds each container to its own Execution ID
from the container's identity, never from anything the request claims, and allows a fixed set of
operations on that Execution only: report a step result or checkpoint, and take, renew or release
a lease. No route on the reserved host returns or changes a credential or token, and none touches
another Execution.

- **Provider leases.** An agentic step holds a lease on its provider while it runs: claude has 3
  and openai has 1. A lease has a TTL and is kept alive while the step runs, so a lease held by a
  container that died expires instead of blocking the provider.
- **Checkpoints.** The Durable Object records a checkpoint after every step.
- **Resume.** An interrupted Execution resumes from its last successful step. A step can run
  more than once, so semantics are at-least-once.
- **Workspace between steps.** When the registration's permission ceiling allows pushing, a
  hidden ref holds the workspace between steps, so a resumed Execution recovers its work.
- **Blocked pauses.** A provider that blocks pauses only the steps that use it, so a block on one
  provider does not stop an Execution that can continue on the other.

## Rejected alternatives

**One long-lived container running many Executions.** Executions would share a filesystem and
processes, so a model steered by untrusted input in one could reach another's workspace, and a
crash would take all of them down.

**A container per step.** The engine's deterministic steps are cheap, and a container start per
step would pay the start cost many times and lose the in-process state that steps share.

**The engine keeping its own state.** State in the container is lost with it. Held in the Durable
Object, it survives a container exit and lets a new container resume.

## Consequences

- The engine reaches the Durable Object only through the Outbound Worker, so what the container
  can ask for is what that interception allows.
- A step has to tolerate running twice, because a resume can repeat the step that was in flight.
- A workspace held only in a hidden ref exists only when the ceiling permits a push; without it
  an interrupted Execution resumes from a fresh workspace.
- The model session and the engine share a container, so the Outbound Worker cannot tell their
  requests apart. A steered model session can write step results and checkpoints for any step of
  its own Execution, not for another Execution. A forged checkpoint can make a resumed Execution
  skip steps, deterministic verification and review gates included, and the token's scope does not
  limit that. The Factory accepts this risk: the Execution's record is only as trustworthy as the
  model sessions that ran in it, and a pull request an Execution opens is still read by a person
  before it merges.
