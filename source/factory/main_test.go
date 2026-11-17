package main

import (
	"bytes"
	"testing"
)

func TestRunPrintsTheVersion(t *testing.T) {
	var out bytes.Buffer
	if code := run(nil, &out); code != 0 {
		t.Fatalf("run returned %d, want 0", code)
	}
	if got, want := out.String(), "factory dev\n"; got != want {
		t.Fatalf("run wrote %q, want %q", got, want)
	}
}
