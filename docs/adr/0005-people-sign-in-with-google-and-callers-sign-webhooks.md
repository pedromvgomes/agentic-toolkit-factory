# People sign in with Google and callers sign webhooks

## Context

The Factory's API accepts two kinds of caller. People, and the macOS app acting for one, start
and watch Executions. Other systems cannot hold an interactive session and need a way to start a
Workflow Execution from outside, such as a CI job or a webhook from another service.

The Factory is reachable on the public internet, so every route needs an authentication that a
stranger cannot satisfy.

## Decision

**People and the macOS app** sign in with Google, and the Worker checks the signed-in account
against an allowlist. The allowlist holds one account.

**Callers that cannot sign in** use HMAC-signed webhooks. Each Workflow Definition has one
Webhook registration, with:

- a hard-to-guess URL;
- a secret, shown once when the registration is created;
- a timestamp inside the signature, so a captured request cannot be replayed later;
- delivery IDs, with a replayed ID refused;
- inputs validated against the outputs the trigger declares, so a delivery carries only what the
  definition expects.

Re-registering a Workflow Definition issues a new URL and a new secret and ends the old pair.

## Rejected alternatives

**One shared bearer token for every caller.** A leak of one caller's copy exposes every
definition, and revoking it breaks every caller at once. One registration per definition limits a
leak to one definition and one re-registration.

**Google sign-in for webhook callers.** A service has no browser session to sign in with, so the
only options are to hold a long-lived credential for a person's account or to give the service a
credential of its own. A per-registration secret is the second, scoped to one definition.

## Consequences

- Adding a person is an allowlist change in the Worker, not a new auth mechanism.
- A secret shown once cannot be recovered. A caller that loses it re-registers, and the old URL
  stops working.
- A webhook caller can start only the definition it is registered for, with inputs of the shape
  that definition declares.
