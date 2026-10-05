#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$root/nanthai" runtime stop --wait
# unpair checks that the host has exited before removing the local credential.
"$root/nanthai" unpair
printf 'Stopped and unpaired. Move this installation folder to Trash: %s\nCanonical results and personal Codex installation are preserved.\n' "$root"
