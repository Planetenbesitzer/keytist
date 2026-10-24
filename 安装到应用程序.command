#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
bash scripts/install-macos-app.sh
studio_status=$?
if [[ $studio_status -ne 0 ]]; then
  print '安装未完成。普通启动可以使用“启动 Slide Studio.command”。'
else
  print '安装完成，可以从“应用程序”打开 Slide Studio。'
fi
read -k 1 '?按任意键关闭窗口…'
exit $studio_status
