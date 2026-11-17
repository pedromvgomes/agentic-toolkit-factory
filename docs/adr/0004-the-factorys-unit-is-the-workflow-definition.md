# The Factory's unit is the Workflow Definition

## Context

The Factory does more than one kind of work: implementing a Backlog item is the first, and other
repositories want others. A loop hard-coded around one job makes each new job a change to the
Factory's code, and a job that only one repository needs ends up in everyone's binary.

hatua defines a Workflow Definition and a runner that executes it. Workflow Definition is a
category in agentic-toolkit, so a definition is shared across repositories, and each repository
hosts the definitions it uses.

## Decision

The Factory's unit of work is the Workflow Definition: a hatua Workflow Definition, hosted in the
repository it acts on. A hatua runner executes it, with `agtk-factory`'s own agentic and script
steps registered as the step kinds a definition can use.

The Worker reads a definition at the head of the repository's default branch, resolved to a
commit SHA, and records that SHA on the Workflow Execution. The Execution runs the definition as
it was at that commit, whatever lands on the branch afterwards.

## Rejected alternatives

**A fixed pipeline in the Factory's code.** Each new kind of work becomes a change and a release
of `agtk-factory`, and a repository cannot shape its own work without changing the Factory.

**Reading the definition by branch name at run time.** A push to the branch while an Execution
runs changes what the remaining steps are, and the Execution cannot say afterwards which
definition it ran. A resolved SHA makes the definition a fixed input.

## Consequences

- A repository changes what the Factory does there with a pull request to its own definitions,
  not to this repository.
- An Execution's record names the exact definition commit, so a run can be reproduced and
  resumed against the same steps.
- The step kinds `agtk-factory` registers are the vocabulary every definition shares; a step a
  definition needs that does not exist is added here.
