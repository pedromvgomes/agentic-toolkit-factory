package main

import (
	"bytes"
	"errors"
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

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("write failed") }

func TestRunFailsWhenTheVersionCannotBeWritten(t *testing.T) {
	if code := run(nil, failingWriter{}); code != 1 {
		t.Fatalf("run returned %d, want 1", code)
	}
}
