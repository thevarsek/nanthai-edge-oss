#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination=${1:-"$HOME/Applications/NanthAI Runtime Host"}
if [ -e "$destination" ]; then
  echo "Destination exists. Stop the old host and move its folder aside for rollback, then run this installer again." >&2
  exit 1
fi
mkdir -p "$(dirname -- "$destination")"
cp -R "$source_dir" "$destination"
printf 'Installed. Run: "%s/nanthai" --help\n' "$destination"
