---
about: "source/factory/main_test.go"
saw:
  - "go.vipengele.org/cli/spec@v0.1.0 speccheck/speccheck.go, the doc comment on AssertJSONKeys"
---

`TestVersionJSONWritesTheBuildInformationContract` compares `version --json` to
`internal/testdata/version-json.golden` with `speccheck.AssertJSONKeys`, which checks the set of
key paths and not their values. The values the test cares about (`schema`, `version`) are
asserted separately in the test body. A framework upgrade that adds a key to the JSON fails the
test until the golden is regenerated with `SPECCHECK_UPDATE=1`; that coupling is intended.
