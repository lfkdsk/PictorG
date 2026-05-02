#!/bin/bash
# PicG — clear the macOS quarantine flag on the installed app.
#
# Why this exists: PicG isn't signed with an Apple Developer ID
# certificate yet, so the first time you try to open it macOS shows
# "PicG.app is damaged and can't be opened. You should move it to
# the Trash." The app isn't actually damaged — Gatekeeper is just
# refusing to launch any unsigned binary that was downloaded from
# the internet.
#
# This script runs `xattr -c` on /Applications/PicG.app, which clears
# the com.apple.quarantine flag macOS adds to downloaded files. After
# that the app launches normally on every subsequent open.
#
# Run this once, after dragging PicG into Applications. You'll see
# a "this app was downloaded from the internet" prompt the first
# time you double-click this script too — click Open. From then on
# both the script and the app are trusted.

set -e

APP="/Applications/PicG.app"

if [ ! -d "$APP" ]; then
  echo "PicG.app not found at $APP."
  echo "Drag PicG into the Applications folder first, then run this again."
  read -n 1 -s -r -p "Press any key to close…"
  echo
  exit 1
fi

echo "Clearing quarantine flag on $APP…"
xattr -c "$APP"
echo "Done. You can now open PicG from the Applications folder."
echo
read -n 1 -s -r -p "Press any key to close…"
echo
