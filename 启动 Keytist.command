#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '需要 Node.js 20 或更新版本。安装后重新打开此文件。'
  read -k 1
  exit 1
fi
if [[ ! -f dist/index.html ]]; then
  npm ci && npm run build || { print '构建没有完成。'; read -k 1; exit 1; }
fi
exec node scripts/serve.mjs --open
