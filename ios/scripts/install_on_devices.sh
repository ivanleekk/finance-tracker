#!/usr/bin/env bash
# Archives a Release build and installs it on every paired physical device.
# See ios/AGENTS.md "Release Build & Install on Your Own Device" for the manual steps this automates.
set -euo pipefail

cd "$(dirname "$0")/.."  # ios/

PROJECT="FinanceTracker.xcodeproj"
SCHEME="FinanceTracker"
BUNDLE_ID="com.ivanlee.financetracker"
ARCHIVE_PATH="build/FinanceTracker.xcarchive"
EXPORT_PATH="build/export"
EXPORT_OPTIONS="exportOptions.plist"
LAUNCH_AFTER_INSTALL="${LAUNCH_AFTER_INSTALL:-1}"

if [[ ! -f "$EXPORT_OPTIONS" ]]; then
  echo "==> Creating $EXPORT_OPTIONS (development export, team 9SA33W38S2)"
  cat > "$EXPORT_OPTIONS" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>development</string>
  <key>teamID</key><string>9SA33W38S2</string>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
PLIST
fi

echo "==> xcodegen generate"
xcodegen generate

echo "==> Discovering paired devices"
DEVICE_LIST_JSON="$(mktemp)"
trap 'rm -f "$DEVICE_LIST_JSON"' EXIT
xcrun devicectl list devices --json-output "$DEVICE_LIST_JSON" >/dev/null

# One "udid\tname" pair per paired-and-available physical device.
# (macOS ships bash 3.2, which has no `mapfile` — use a portable read loop instead.)
DEVICE_ROWS="$(python3 - "$DEVICE_LIST_JSON" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for d in data.get("result", {}).get("devices", []):
    conn = d.get("connectionProperties", {}) or {}
    if conn.get("pairingState") != "paired":
        continue
    ident = d.get("identifier")
    name = d.get("deviceProperties", {}).get("name", ident)
    if ident:
        print(f"{ident}\t{name}")
PY
)"

DEVICES=()
while IFS=$'\t' read -r udid name; do
  [[ -n "$udid" ]] && DEVICES+=("$udid"$'\t'"$name")
done <<< "$DEVICE_ROWS"

if [[ "${#DEVICES[@]}" -eq 0 ]]; then
  echo "No paired devices found. Plug in / pair a device (or open Xcode ▸ Window ▸ Devices and Simulators) and retry." >&2
  exit 1
fi

echo "==> Found ${#DEVICES[@]} device(s):"
for entry in "${DEVICES[@]}"; do
  echo "    - ${entry#*$'\t'} (${entry%%$'\t'*})"
done

echo "==> Archiving Release build"
xcodebuild archive \
  -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE_PATH"

echo "==> Exporting IPA"
xcodebuild -exportArchive -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" -exportPath "$EXPORT_PATH"

IPA_PATH="$(find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' | head -1)"
if [[ -z "$IPA_PATH" ]]; then
  echo "Export succeeded but no .ipa was found in $EXPORT_PATH" >&2
  exit 1
fi

FAILED_DEVICES=()

for entry in "${DEVICES[@]}"; do
  udid="${entry%%$'\t'*}"
  name="${entry#*$'\t'}"
  echo "==> Installing on $name ($udid)"
  if ! xcrun devicectl device install app --device "$udid" "$IPA_PATH"; then
    echo "    (install failed — device may be unreachable/locked; skipping to next device)" >&2
    FAILED_DEVICES+=("$name ($udid)")
    continue
  fi

  if [[ "$LAUNCH_AFTER_INSTALL" == "1" ]]; then
    echo "==> Launching on $name"
    xcrun devicectl device process launch --device "$udid" "$BUNDLE_ID" || \
      echo "    (launch failed — install succeeded, open it manually on the device)"
  fi
done

if [[ "${#FAILED_DEVICES[@]}" -gt 0 ]]; then
  echo "==> Done, with ${#FAILED_DEVICES[@]} failure(s):"
  for f in "${FAILED_DEVICES[@]}"; do
    echo "    - $f"
  done
else
  echo "==> Done."
fi
