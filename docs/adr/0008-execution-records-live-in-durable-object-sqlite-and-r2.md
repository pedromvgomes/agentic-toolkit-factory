# Execution records live in Durable Object SQLite and R2

## Context

An Execution produces two kinds of record. The structured part is small and queried: the
Execution, its steps, its inputs and the marked prompt. The transcripts are large, append-only
and read rarely, usually after something went wrong.

Both hold text a model produced or read, which can include repository content, so they should
not accumulate indefinitely.

## Decision

Durable Object SQLite holds the Executions, their steps, their inputs and the marked prompt. R2
holds the transcripts, capped in size. Both expire after 90 days, and the Durable Object's alarm
prunes them.

## Rejected alternatives

**Transcripts in SQLite.** Large rows inflate the store the supervisor reads on every start and
resume, and a capped object store holds them more cheaply.

**Keeping records indefinitely.** Transcripts accumulate content the Factory has no use for
after an Execution is settled, and a retention window bounds how long that content exists.

## Consequences

- Looking at a recent Execution reads one SQLite row set and, when needed, one R2 object.
- After 90 days an Execution's record and transcript are gone; anything that must outlive that
  lives in the pull request or issue the Execution touched.
- The alarm that prunes is the same mechanism the Durable Object already uses for supervision, so
  retention needs no separate scheduler.
