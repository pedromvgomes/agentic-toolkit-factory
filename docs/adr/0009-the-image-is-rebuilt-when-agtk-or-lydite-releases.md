# The image is rebuilt when agtk or lydite releases

## Context

Every Execution's container runs the same image, which carries the tools the steps call, among
them `agtk` and `lydite`. Those tools release on their own schedule, and an Execution that needs
a fix in one must run the image that has it.

A tool installed when the container starts is fetched from the network on every Execution, so
the Execution depends on a download it did not choose and cannot be reproduced from its record.

## Decision

The image is rebuilt and never installed into at run time. A job every two hours checks for newer
`agtk` and `lydite` releases. When one exists it updates the image's bill of materials and opens a
pull request, and merging that pull request builds the image.

Each Execution records the image digest and the tool versions it ran with.

## Rejected alternatives

**Installing the tools when an Execution starts.** The start depends on a download, two
Executions of the same definition can run different tool versions, and a run cannot be tied to
what it executed.

**Building the image on every release automatically.** A release would reach every Execution
with no one reading the change, where a pull request puts the new version in front of a person
before it is built.

## Consequences

- A new `agtk` or `lydite` release reaches Executions after the job's next check and a merge, not
  immediately.
- The digest and tool versions on an Execution identify the image it ran in, so a regression is
  traced to an image change.
- The bill of materials is the one place the tool versions are written.
