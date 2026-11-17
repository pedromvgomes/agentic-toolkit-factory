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

// run writes the build's version and returns the process exit code.
func run(_ []string, stdout io.Writer) int {
	fmt.Fprintf(stdout, "factory %s\n", version)
	return 0
}
