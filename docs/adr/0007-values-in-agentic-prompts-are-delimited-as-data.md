# Values in agentic prompts are delimited as data

## Context

An agentic step's prompt is built from a template and from values: a Backlog item's body, a
comment, a webhook input. Some of those values are written by people the Factory does not
control. A value placed straight into a prompt can carry instructions, and a model has no
reliable way to tell the template's instructions from instructions inside a value.

## Decision

Every value substituted into an agentic prompt is wrapped in a delimited block. The boundary of
the block is a random string generated for each run, so a value written before the run cannot
contain the closing delimiter, and the prompt carries a preamble that says the content of the
blocks is data and not instructions.

The boundary is visible to the model in every prompt of the run, and one step's outputs feed the
next step's inputs, so a model steered in an early step can write the boundary into an output. A
value that contains the boundary string is therefore rejected before it is substituted, whichever
step produced it.

An opt-in function inserts a value unwrapped. It is available only when the registration allows
it for that input, so a definition cannot unwrap an input the registration did not clear.

This is a mitigation. A model can still follow instructions inside a delimited block, so the
control that bounds the harm is the scope of the Execution's token (see
[ADR 0003](0003-code-access-comes-from-a-per-execution-token-of-a-second-app.md)).

## Rejected alternatives

**Substituting values directly.** A value that reads as an instruction is read as one, and the
prompt has no marker that separates what the Factory wrote from what a stranger wrote.

**Relying on delimiters alone.** Delimiters reduce how often a model obeys a value but do not
stop it, so treating them as the control would leave an Execution with a broad token exposed to
any body it reads.

**A fixed delimiter.** A value that contains the delimiter can close the block and continue as
instructions. A per-run random boundary cannot be known to whoever wrote the value.

## Consequences

- Every prompt contains the preamble and its blocks, in a form the marked prompt records on the
  Execution.
- Unwrapped insertion is a registration decision, visible where the registration is made, not a
  choice made inside a definition.
- A Workflow Definition's safety depends on its token ceiling first and on the delimiting
  second.
