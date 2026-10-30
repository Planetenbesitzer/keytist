#!/bin/bash
set -euo pipefail

keytist_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
keytist_staging=0
keytist_configuration=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging-only) keytist_staging=1; shift ;;
    --configuration)
      [[ $# -ge 2 ]] || { echo '--configuration 需要配置文件路径。' >&2; exit 1; }
      keytist_configuration="$2"; shift 2 ;;
    *) echo "未知选项：$1" >&2; exit 1 ;;
  esac
done
if [[ "$keytist_staging" -eq 1 && -z "${APP_DIR:-}" ]]; then
  echo '仅构建模式需要 APP_DIR 指定专用测试文件夹。' >&2
  exit 1
fi

keytist_node="$(command -v node || true)"
if [[ -z "$keytist_node" || ! -x "$keytist_node" ]]; then
  echo '未找到 Node.js，请先安装本机运行环境。' >&2
  exit 1
fi
keytist_version="$("$keytist_node" -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version; if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version in package.json"); process.stdout.write(version)' "$keytist_repo/package.json")"
keytist_parent="${APP_DIR:-/Applications}"
if [[ -z "${APP_DIR:-}" && ! -w "$keytist_parent" ]]; then
  keytist_parent="$HOME/Applications"
fi
mkdir -p "$keytist_parent"
keytist_parent="$(cd -- "$keytist_parent" && pwd -P)"
keytist_destination="$keytist_parent/Keytist.app"
keytist_legacy="$keytist_parent/Slide Studio.app"
keytist_bundle_id='local.slidestudio.launcher'
keytist_legacy_owned=0
for keytist_existing in "$keytist_destination" "$keytist_legacy"; do
  [[ -e "$keytist_existing" || -L "$keytist_existing" ]] || continue
  keytist_existing_id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$keytist_existing/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$keytist_existing_id" != "$keytist_bundle_id" ]]; then
    if [[ "$keytist_existing" == "$keytist_destination" ]]; then
      echo "此位置已有其他应用，未覆盖：$keytist_destination" >&2
      exit 1
    fi
    continue
  fi
  [[ "$keytist_existing" != "$keytist_legacy" ]] || keytist_legacy_owned=1
  if [[ -z "$keytist_configuration" ]]; then
    keytist_configuration="$keytist_existing/Contents/Resources/launcher.json"
  fi
done
if [[ -z "$keytist_configuration" && ! -f "$keytist_repo/dist/index.html" ]]; then
  echo '请先在项目目录运行 npm run build，再安装启动器。' >&2
  exit 1
fi

# Build next to the destination so each final move stays on the same volume.
keytist_build="$(mktemp -d "$keytist_parent/.Keytist-install.XXXXXX")"
keytist_backup="$keytist_build/Previous Keytist.app"
keytist_legacy_backup="$keytist_build/Previous Slide Studio.app"
keytist_installed=0
keytist_registered=0
keytist_legacy_unregistered=0
keytist_committed=0
keytist_lsregister='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
cleanup() {
  keytist_status=$?
  trap - EXIT
  if [[ "$keytist_committed" -eq 0 ]]; then
    if [[ "$keytist_registered" -eq 1 ]]; then
      "$keytist_lsregister" -u "$keytist_destination" >/dev/null 2>&1 || true
    fi
    if [[ "$keytist_installed" -eq 1 ]]; then
      rm -rf -- "$keytist_destination"
    fi
    if [[ -e "$keytist_backup" || -L "$keytist_backup" ]]; then
      mv "$keytist_backup" "$keytist_destination" || { echo "请保留恢复目录：$keytist_build" >&2; exit 1; }
      [[ "$keytist_staging" -eq 1 ]] || "$keytist_lsregister" -f "$keytist_destination" >/dev/null 2>&1 || true
    fi
    if [[ -e "$keytist_legacy_backup" || -L "$keytist_legacy_backup" ]]; then
      mv "$keytist_legacy_backup" "$keytist_legacy" || { echo "请保留恢复目录：$keytist_build" >&2; exit 1; }
    fi
    if [[ "$keytist_legacy_unregistered" -eq 1 && -e "$keytist_legacy" ]]; then
      "$keytist_lsregister" -f "$keytist_legacy" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf -- "$keytist_build"
  exit "$keytist_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
keytist_bundle="$keytist_build/Keytist.app"
mkdir -p "$keytist_bundle/Contents/MacOS" "$keytist_bundle/Contents/Resources"

keytist_target="$(uname -m)-apple-macosx12.0"
/usr/bin/xcrun swiftc -O -swift-version 5 -module-cache-path "$keytist_build/ModuleCache" -parse-as-library -target "$keytist_target" -framework AppKit "$keytist_repo/scripts/macos/Launcher.swift" "$keytist_repo/scripts/macos/LauncherSupport.swift" -o "$keytist_bundle/Contents/MacOS/Keytist"
/usr/bin/xcrun swiftc -O -swift-version 5 -module-cache-path "$keytist_build/ModuleCache" -framework AppKit "$keytist_repo/scripts/macos/RenderIcon.swift" -o "$keytist_build/render-icon"
"$keytist_build/render-icon" "$keytist_repo/public/studio.svg" "$keytist_build/Keytist.iconset"
/usr/bin/iconutil -c icns "$keytist_build/Keytist.iconset" -o "$keytist_bundle/Contents/Resources/Keytist.icns"

"$keytist_node" "$keytist_repo/scripts/macos/launcher-config.mjs" "$keytist_repo" "$keytist_node" "$keytist_bundle/Contents/Resources/launcher.json" "$keytist_configuration"
cat > "$keytist_bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${keytist_bundle_id}</string>
  <key>CFBundleName</key><string>Keytist</string>
  <key>CFBundleDisplayName</key><string>Keytist</string>
  <key>CFBundleExecutable</key><string>Keytist</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Keytist</string>
  <key>CFBundleShortVersionString</key><string>${keytist_version}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$keytist_bundle/Contents/Info.plist"
/usr/bin/codesign --force --deep --sign - "$keytist_bundle"
/usr/bin/codesign --verify --deep --strict "$keytist_bundle"
# --check only probes the existing page; it never starts a server or a browser.
"$keytist_bundle/Contents/MacOS/Keytist" --check

if [[ -e "$keytist_destination" || -L "$keytist_destination" ]]; then
  mv "$keytist_destination" "$keytist_backup"
fi
mv "$keytist_bundle" "$keytist_destination"
keytist_installed=1
if [[ "$keytist_staging" -eq 0 ]]; then
  keytist_registered=1
  "$keytist_lsregister" -f "$keytist_destination"
fi
"$keytist_destination/Contents/MacOS/Keytist" --check
if [[ "$keytist_staging" -eq 0 && "$keytist_legacy_owned" -eq 1 ]]; then
  keytist_legacy_unregistered=1
  "$keytist_lsregister" -u "$keytist_legacy"
  mv "$keytist_legacy" "$keytist_legacy_backup"
fi
keytist_committed=1
if [[ "$keytist_staging" -eq 1 ]]; then
  echo "已构建并核验（未安装或启动）：$keytist_destination"
else
  echo "已安装：$keytist_destination"
fi
