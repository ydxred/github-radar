#!/usr/bin/env bash
set -euo pipefail
radar_url='http://127.0.0.1:4317'
radar_service='github-top.service'
radar_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
report_error() {
  if command -v notify-send >/dev/null 2>&1; then notify-send --icon=dialog-error '开源雷达暂时未能启动' "$1"; fi
  printf '%s\n' "$1" >&2
  exit 1
}
if ! systemctl --user start "$radar_service"; then
  report_error "请查看 $radar_root/README.md 的启动排查说明。"
fi
for radar_attempt in {1..40}; do
  if curl --noproxy '*' --connect-timeout 1 --max-time 2 -fsS "$radar_url/api/health" 2>/dev/null | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("app")=="github-top" and d.get("ok") else 1)' 2>/dev/null; then
    if [[ "${1:-}" == '--check' ]]; then printf '开源雷达已就绪：%s\n' "$radar_url"; exit 0; fi
    exec xdg-open "$radar_url"
  fi
  sleep 0.25
done
report_error '本机服务启动超时，可能有其他程序占用了 4317 端口。可重试或查看项目使用说明。'
