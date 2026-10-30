#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 20 or newer is required. Install it, then run this file again.' >&2
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo 'The built application is missing. Extract the complete ZIP archive first.' >&2
  exit 1
fi
echo 'Keytist: open http://127.0.0.1:4178 in your browser.'
echo 'Keep this window open. Press Ctrl+C to stop.'
exec node scripts/serve.mjs
