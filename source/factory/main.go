// Command factory runs the Factory: the loop that takes agentic-toolkit Backlog
// items from agtk:queued to an open pull request without a person starting them.
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
