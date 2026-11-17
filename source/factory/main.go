// Command agtk-factory runs the Factory: the loop that starts agentic-toolkit Workflow
// Executions from their triggers without a person starting them. The Execution that
// implements a Backlog item takes it from agtk:queued to an open pull request.
package main

import (
	"os"

	cli "go.vipengele.org/cli/core"
	"go.vipengele.org/cli/spec"

	"github.com/pedromvgomes/agentic-toolkit-factory/source/factory/internal/command/run"
)

func main() {
	os.Exit(newApp().Execute())
}

// identity is the tool's identity: the binary's name, its repository, the prefix of its
// environment variables and the directory it owns under the platform's roots.
func identity() spec.Identity {
	return spec.Identity{
		Name:      "agtk-factory",
		Owner:     "pedromvgomes",
		Repo:      "agentic-toolkit-factory",
		EnvPrefix: "AGTK_FACTORY",
		DirName:   "agtk-factory",
	}
}

// newApp builds the App with the standard -v and --json flags and the Factory's commands. opts
// follow the standard options, so a test fixes what "version" prints with cli.WithBuildInfo.
// The App adds "version" itself; a command of that name added here makes the tree invalid.
func newApp(opts ...cli.Option) *cli.App {
	app := cli.New(identity(), append([]cli.Option{cli.WithVerbose(), cli.WithJSON()}, opts...)...)
	app.Add(run.New())
	return app
}
