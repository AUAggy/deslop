#!/bin/sh
# macOS registers the VS Code builds that @vscode/test-electron downloads into
# .vscode-test/ the moment the test harness launches them, so they pile up in
# Finder's "Open With" menu. Unregister them after each test run.
[ "$(uname -s)" = "Darwin" ] || exit 0
dir="$(cd "$(dirname "$0")/.." && pwd)/.vscode-test"
[ -d "$dir" ] || exit 0
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u -R "$dir"
