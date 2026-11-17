# Code access comes from a per-Execution token of a second GitHub App

## Context

The Factory does two kinds of GitHub work. It reads and labels Backlog items: unblocking,
queuing and dispatching. And a Workflow Execution does whatever its Workflow Definition does,
which for "implement backlog item" means pushing a branch and opening a pull request, and for
other definitions may mean more.

The two carry different risk. Issue work is the Factory's own and is the same on every run.
Code work is done by a model reading untrusted text with egress to GitHub, and its reach should be
exactly what one Execution needs and no more. An installation token reaches every repository the
App is installed on, with every permission the App holds.

## Decision

The Factory uses two GitHub Apps.

- **The Factory App** holds issues read/write and metadata read, and no contents permission. One
  component holds its private key. It does the Factory's issue work and nothing else, and it
  cannot read or write code anywhere.
- **A second, code-capable App** supplies code access. For each Workflow Execution the Worker
  mints an installation token narrowed to the one repository the Execution acts on and to the
  permission ceiling recorded on the definition's registration. The token is held in the Durable
  Object, injected by the Outbound Worker on requests to GitHub, and never enters the container.
  An installation token lasts an hour, so the Worker mints a new one before the hour ends for an
  Execution that is still running.

The permission ceiling belongs to the registration, not to the Workflow Definition file. A
definition cannot raise its own permissions: the most it can do is ask for less than the ceiling.

A repository that hosts Workflow Definitions protects its default branch and requires CODEOWNERS
review on `workflows/`, so a change to what a Workflow does passes through a person before the
Factory reads it.

## Rejected alternatives

**One App with contents write.** It would need one key and one installation, but every token it
issues, including the one used for routine issue labelling, would reach code in every repository
it is installed on, and a leak of that key or of any token would carry write access to all of
them.

**The token in the container.** The CLIs and `git` would authenticate without an interceptor,
but a model steered by an untrusted body could read the token and use it outside the Execution,
for as long as it lives, against anything its permissions reach.

**Permissions declared in the Workflow Definition.** The definition is the thing being
constrained. A definition that names its own permissions is one pull request away from naming
more, and the review of that pull request would become the only control.

## Consequences

- What a misbehaving Execution can do is bounded by one repository and one registration's
  ceiling, for at most an hour per token, through the Worker only.
- A git push from the container carries a placeholder credential and relies on the Outbound
  Worker to swap it. The spike covered the Anthropic and ChatGPT hosts, not GitHub, so this is
  confirmed when the Outbound Worker is built.
- The Factory App's boundary, issue permissions and no access to code, is a property of its
  registration on GitHub, not of a convention in this code.
- Branch protection with CODEOWNERS on `workflows/` is a precondition for hosting Workflows. A
  repository without it lets anyone who can push change what the Factory runs there, up to the
  registration's ceiling.
