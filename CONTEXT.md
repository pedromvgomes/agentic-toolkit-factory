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
The loop that starts **Workflow Execution**s from their triggers without a person starting them:
unblocking **Backlog item**s whose **Predecessor**s are done, sweeping stalled items back to the
queue, and dispatching. A Workflow Execution does what its **Workflow Definition**'s **Step**s do
and nothing more; the one that implements a Backlog item takes it from queued to an open pull
request and stops there because its own Steps do.
_Avoid_: pipeline, automation, bot

**Dispatcher**:
The part of the **Factory** that chooses which queued **Backlog item**s start, within the caps
it keeps on how many run at once, and starts a **Workflow Execution** for each.
_Avoid_: scheduler, runner, picker

**Factory App**:
The GitHub App the **Factory** acts as. Holds issue permissions and no access to code, and its
key has one holder. Code-capable work in a **Workflow Execution** is done with a token issued for
that Workflow Execution alone, never with the Factory App's. Distinct from the review **App
registration**, and never the **Relay**.
_Avoid_: bot, factory token

**Workflow Definition**:
The declarative description of an automated procedure, authored as YAML in hatua's Workflow
Definition format (hatua's own glossary uses the same term): its triggers, its **Step**s, how
one Step's outputs map to the next Step's inputs, and where it forks, repeats or recovers.
Distinct from a GitHub Actions workflow, which this repository names in full.
_Avoid_: workflow, pipeline, playbook, recipe

**Workflow Execution**:
One run of a **Workflow Definition** at one resolved commit: the trigger that started it, its
inputs, how each **Step** ended, and its outcome. Read, never edited.
_Avoid_: workflow run, job, build, pipeline run

**Step**:
One node of a **Workflow Definition**. An agentic Step runs a model session, a script Step runs
a command, and a control-flow Step — fork, repeat, for_each, try, set_var — is evaluated without
a model. Distinct from a **Task**, which is a unit of a **Backlog item**'s plan.
_Avoid_: task, stage, action, job

**Webhook registration**:
What makes one **Workflow Definition** triggerable from outside. It names a repository and the
Workflow Definition, holds the hard-to-guess URL and the signing secret issued for it, fixes the
ceiling on the token permissions a **Workflow Execution** it starts is given, and says which
inputs may be substituted unwrapped into a prompt.
_Avoid_: webhook, hook, endpoint

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
