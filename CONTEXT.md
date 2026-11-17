# agentic-toolkit-factory

The **Factory** that takes agentic-toolkit **Backlog item**s from `agtk:queued` to an open pull
request without a person starting them.

## Language

The terms below belong to agentic-toolkit and are copied verbatim from its
[`CONTEXT.md`](https://github.com/pedromvgomes/agentic-toolkit/blob/main/CONTEXT.md), which stays
authoritative. Change a definition there and copy it back here; never redefine one in this repo.
A bold term used below but not listed here — **Slice**, **Task**, **Handoff**, **Cloud session**,
**App registration**, **Relay**, **Approval** — has the meaning agentic-toolkit gives it.

**Backlog**:
The set of a repo's open **Backlog item**s, in every state. One per repo; it is read from GitHub
on demand and kept nowhere else.
_Avoid_: queue, docket, board

**Backlog item**:
A GitHub issue in the **Backlog**: the unit the **Factory** moves through its states and the
**Dispatcher** picks up. It carries its state, its **Predecessor**s and its place under a
**Feature**; its body carries the work — goal, **Task**s, verification. Only the body is ever
read as work: comments on it never are.
_Avoid_: ticket, story, card, job

**Stub**:
A **Backlog item** whose body holds a goal and nothing to implement yet. Filled by the session
that lands the **Slice** before it, and never queued while it is a stub.
_Avoid_: placeholder, skeleton

**Feature**:
The issue a plan is made for. Its **Slice**s' **Backlog item**s are its sub-issues; it is never
one itself — never dispatched, never in a state — and it closes when its last item closes.
_Avoid_: epic, request issue, parent issue

**Factory**:
The loop that takes a **Backlog item** from queued to an open pull request without a person
starting it: unblocking items whose **Predecessor**s are done, sweeping stalled runs back to the
queue, and dispatching. Stops at the pull request; merging is never the factory's.
_Avoid_: pipeline, automation, bot

**Dispatcher**:
The step of the **Factory** that chooses which queued **Backlog item**s start, within a fixed
number running at once, and starts a **Cloud session** for each.
_Avoid_: scheduler, runner, picker

**Factory App**:
The GitHub App the **Factory** acts as. Holds issue permissions and no access to code, and its
key has one holder. Distinct from the review **App registration**, and never the **Relay**.
_Avoid_: bot, factory token

**Predecessor**:
The pull request a **Handoff**'s work may not start before, merged into the base branch. A
handoff written while a PR is open has one; a handoff written with no PR open has none, and
its session resumes on the same branch immediately.

It decides *waiting*, not *where*: the worktree is a constant, so a handoff with a predecessor
resumes by branching off the updated base in the same directory. Reading it is automatic and
moving the branch is not — the first spends nothing, and the second changes where somebody is
standing.

Not "gate", which **Approval** already lists as a word to avoid. The two are different enough
that one word for both would be a real loss: a predecessor is a fact about ordering that any
session can read from GitHub, and approval is a control that no model may reach.
_Avoid_: gate, dependency, blocker, prerequisite
