// Command factory runs the Factory: the loop that starts agentic-toolkit Workflow
// Executions from their triggers without a person starting them. The Execution that
// implements a Backlog item takes it from agtk:queued to an open pull request.
package main

import (
	"fmt"
	"io"
	"os"
)

// version is set at build time with -ldflags "-X main.version=<v>".
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout))
}

// run writes the build's version and returns the process exit code: 1 when
// the version cannot be written, since nothing else would report it.
func run(_ []string, stdout io.Writer) int {
	if _, err := fmt.Fprintf(stdout, "factory %s\n", version); err != nil {
		return 1
	}
	return 0
}
