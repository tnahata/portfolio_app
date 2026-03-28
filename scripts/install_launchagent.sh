#!/bin/bash
# Installs (or uninstalls) the portfolio sync LaunchAgent.
#
# Usage:
#   ./scripts/install_launchagent.sh          # install
#   ./scripts/install_launchagent.sh uninstall # remove

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_LABEL="com.portfolio-viz.sync-sheets"
PLIST_SRC="$SCRIPT_DIR/$PLIST_LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_DIR="$PROJECT_ROOT/logs"

uninstall() {
	if launchctl list | grep -q "$PLIST_LABEL"; then
		launchctl unload "$PLIST_DEST"
		echo "✓ Unloaded $PLIST_LABEL"
	fi
	if [ -f "$PLIST_DEST" ]; then
		rm "$PLIST_DEST"
		echo "✓ Removed $PLIST_DEST"
	fi
	echo "Done. LaunchAgent uninstalled."
}

install() {
	mkdir -p "$LOG_DIR"

	sed "s|PROJECT_ROOT|$PROJECT_ROOT|g" "$PLIST_SRC" > "$PLIST_DEST"
	echo "✓ Wrote plist to $PLIST_DEST"

	if launchctl list | grep -q "$PLIST_LABEL"; then
		launchctl unload "$PLIST_DEST"
	fi
	launchctl load "$PLIST_DEST"
	echo "✓ Loaded $PLIST_LABEL"

	echo ""
	echo "LaunchAgent installed. The sheet will sync at 4:15 PM ET every weekday."
	echo "Logs: $LOG_DIR/sync-sheets.log"
	echo ""
	echo "To run immediately:   .venv/bin/python scripts/sync_to_sheets.py"
	echo "To uninstall:         ./scripts/install_launchagent.sh uninstall"
}

if [ "${1:-}" = "uninstall" ]; then
	uninstall
else
	install
fi
