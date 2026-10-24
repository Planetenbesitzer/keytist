#!/bin/bash
set -euo pipefail

studio_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
studio_node="$(command -v node || true)"
if [[ -z "$studio_node" || ! -x "$studio_node" ]]; then
  echo '未找到 Node.js，请先安装本机运行环境。' >&2
  exit 1
fi
studio_version="$("$studio_node" -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version; if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version in package.json"); process.stdout.write(version)' "$studio_repo/package.json")"
if [[ ! -f "$studio_repo/dist/index.html" ]]; then
  echo '请先在项目目录运行 npm run build，再安装启动器。' >&2
  exit 1
fi

studio_parent='/Applications'
if [[ ! -w "$studio_parent" ]]; then
  studio_parent="$HOME/Applications"
  mkdir -p "$studio_parent"
fi
studio_destination="$studio_parent/Slide Studio.app"
if [[ -e "$studio_destination" ]]; then
  studio_existing_id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$studio_destination/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$studio_existing_id" != 'local.slidestudio.launcher' ]]; then
    echo "此位置已有其他应用，未覆盖：$studio_destination" >&2
    exit 1
  fi
fi

studio_build="$(mktemp -d "$studio_parent/.SlideStudio-install.XXXXXX")"
studio_backup=''
cleanup() {
  if [[ -n "$studio_backup" && -d "$studio_backup" && ! -e "$studio_destination" ]]; then
    mv "$studio_backup" "$studio_destination" || return
  fi
  rm -rf -- "$studio_build"
}
trap cleanup EXIT
studio_bundle="$studio_build/Slide Studio.app"
mkdir -p "$studio_bundle/Contents/MacOS" "$studio_bundle/Contents/Resources"

studio_target="$(uname -m)-apple-macosx12.0"
/usr/bin/xcrun swiftc -O -swift-version 5 -target "$studio_target" -framework AppKit "$studio_repo/scripts/macos/Launcher.swift" -o "$studio_bundle/Contents/MacOS/SlideStudio"
/usr/bin/xcrun swiftc -O -swift-version 5 -framework AppKit "$studio_repo/scripts/macos/RenderIcon.swift" -o "$studio_build/render-icon"
"$studio_build/render-icon" "$studio_repo/public/studio.svg" "$studio_build/SlideStudio.iconset"
/usr/bin/iconutil -c icns "$studio_build/SlideStudio.iconset" -o "$studio_bundle/Contents/Resources/SlideStudio.icns"

"$studio_node" --input-type=module - "$studio_repo" "$studio_node" "$studio_bundle/Contents/Resources/launcher.json" <<'NODE'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const [repositoryPath, nodePath, output] = process.argv.slice(2)
const defaultOutputDirectory = path.join(os.homedir(), 'Documents', 'Code', 'SlidesStudio', 'output')
fs.writeFileSync(output, JSON.stringify({ repositoryPath, nodePath, localURL: 'http://127.0.0.1:4178', defaultOutputDirectory }, null, 2) + '\n')
NODE
cat > "$studio_bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>local.slidestudio.launcher</string>
  <key>CFBundleName</key><string>Slide Studio</string>
  <key>CFBundleDisplayName</key><string>Slide Studio</string>
  <key>CFBundleExecutable</key><string>SlideStudio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>SlideStudio</string>
  <key>CFBundleShortVersionString</key><string>${studio_version}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$studio_bundle/Contents/Info.plist"
/usr/bin/codesign --force --deep --sign - "$studio_bundle"
/usr/bin/codesign --verify --deep --strict "$studio_bundle"

if [[ -d "$studio_destination" ]]; then
  studio_backup="$studio_build/Previous Slide Studio.app"
  mv "$studio_destination" "$studio_backup"
fi
mv "$studio_bundle" "$studio_destination"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$studio_destination"
"$studio_destination/Contents/MacOS/SlideStudio" --check
echo "已安装：$studio_destination"
