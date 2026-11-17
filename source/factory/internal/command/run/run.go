// Package run provides the "run" command, which takes the path of a Workflow Definition to run as
// a Workflow Execution.
//
// No engine executes a Workflow Definition, so the command neither opens nor reads the file: it
// returns [ErrNoEngine] for every path, and the execution exits non-zero.
package run

import (
	"context"
	"errors"
	"fmt"

	"go.vipengele.org/cli/spec"
)

// ErrNoEngine is the error the command returns for every Workflow Definition: nothing in the
// Factory can execute one.
var ErrNoEngine = errors.New("no engine can execute a Workflow Definition yet")

// New returns the "run" command, which takes exactly one argument, the path of a Workflow
// Definition, and fails with [ErrNoEngine].
func New() *spec.Command {
	return &spec.Command{
		Name:          "run",
		Summary:       "Run a Workflow Definition as a Workflow Execution",
		Description:   "Run the Workflow Definition at <definition> as a Workflow Execution.",
		Args:          spec.ExactArgs(1),
		ArgCompletion: spec.CompleteFiles(),
		Run: func(_ context.Context, inv *spec.Invocation) error {
			return fmt.Errorf("run %s: %w", inv.Args[0], ErrNoEngine)
		},
	}
}
