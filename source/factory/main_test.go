package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	cli "go.vipengele.org/cli/core"
	"go.vipengele.org/cli/core/buildinfo"
	"go.vipengele.org/cli/spec"
	"go.vipengele.org/cli/spec/speccheck"
)

// testInfo is the build information every test runs with, so "version" prints the same under
// go run, go build and CI.
func testInfo() buildinfo.Info {
	return buildinfo.Info{
		Version:   "v1.2.3",
		Commit:    "0123456789abcdef0123456789abcdef01234567",
		Date:      "2026-01-02T03:04:05Z",
		GoVersion: "go1.27.4",
		OS:        "linux",
		Arch:      "amd64",
	}
}

type result struct {
	code   int
	stdout string
	stderr string
}

// execute runs the App against a fake environment with args and returns what it wrote.
func execute(t *testing.T, args ...string) result {
	t.Helper()
	var stdout, stderr bytes.Buffer
	env := &spec.Env{Stdout: &stdout, Stderr: &stderr, WorkDir: t.TempDir()}
	code := newApp(cli.WithBuildInfo(testInfo())).ExecuteArgs(env, args)
	return result{code: code, stdout: stdout.String(), stderr: stderr.String()}
}

func TestVersionPrintsTheBuildInformation(t *testing.T) {
	r := execute(t, "version")
	if r.code != cli.ExitOK {
		t.Fatalf("exit code = %d, want %d; stderr %q", r.code, cli.ExitOK, r.stderr)
	}
	if want := "v1.2.3 build 0123456789ab\n"; r.stdout != want {
		t.Errorf("stdout = %q, want %q", r.stdout, want)
	}
	if r.stderr != "" {
		t.Errorf("stderr = %q, want empty", r.stderr)
	}
}

func TestVersionJSONWritesTheBuildInformationContract(t *testing.T) {
	r := execute(t, "version", "--json")
	if r.code != cli.ExitOK {
		t.Fatalf("exit code = %d, want %d; stderr %q", r.code, cli.ExitOK, r.stderr)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(r.stdout), &got); err != nil {
		t.Fatalf("stdout %q is not a JSON object: %v", r.stdout, err)
	}
	if got["schema"] != float64(1) {
		t.Errorf("schema = %v, want 1", got["schema"])
	}
	if got["version"] != "v1.2.3" {
		t.Errorf("version = %v, want v1.2.3", got["version"])
	}
	speccheck.AssertJSONKeys(t, got, filepath.Join("internal", "testdata", "version-json.golden"))
}

func TestRunRejectsAnArgumentCountOtherThanOne(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "no definition", args: []string{"run"}, want: "received 0 arguments"},
		{name: "two definitions", args: []string{"run", "a.yaml", "b.yaml"}, want: "received 2 arguments"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := execute(t, tt.args...)
			if r.code != cli.ExitUsage {
				t.Errorf("exit code = %d, want %d", r.code, cli.ExitUsage)
			}
			if !strings.Contains(r.stderr, tt.want) {
				t.Errorf("stderr = %q, want it to contain %q", r.stderr, tt.want)
			}
			if r.stdout != "" {
				t.Errorf("stdout = %q, want empty", r.stdout)
			}
		})
	}
}

func TestRunFailsWithoutAnEngine(t *testing.T) {
	for _, args := range [][]string{
		{"run", "workflow.yaml"},
		{"run", "workflow.yaml", "--json"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			r := execute(t, args...)
			if r.code != cli.ExitError {
				t.Errorf("exit code = %d, want %d", r.code, cli.ExitError)
			}
			for _, want := range []string{"workflow.yaml", "no engine can execute a Workflow Definition"} {
				if !strings.Contains(r.stderr, want) {
					t.Errorf("stderr = %q, want it to contain %q", r.stderr, want)
				}
			}
			if r.stdout != "" {
				t.Errorf("stdout = %q, want empty", r.stdout)
			}
		})
	}
}

func TestHelpListsRunAndTheFrameworkCommands(t *testing.T) {
	r := execute(t, "--help")
	if r.code != cli.ExitOK {
		t.Fatalf("exit code = %d, want %d; stderr %q", r.code, cli.ExitOK, r.stderr)
	}
	if got, want := listedCommands(r.stdout), []string{"run", "version"}; !slices.Equal(got, want) {
		t.Errorf("listed commands = %q, want %q; help:\n%s", got, want, r.stdout)
	}
}

// listedCommands returns the first word of every line of the "Available Commands:" section of
// help.
func listedCommands(help string) []string {
	var names []string
	inSection := false
	for line := range strings.Lines(help) {
		switch {
		case strings.TrimSpace(line) == "Available Commands:":
			inSection = true
		case inSection && strings.TrimSpace(line) == "":
			return names
		case inSection:
			names = append(names, strings.Fields(line)[0])
		}
	}
	return names
}
