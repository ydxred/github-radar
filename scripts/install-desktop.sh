#!/usr/bin/env bash
set -euo pipefail
radar_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
radar_node="$(command -v node)"
radar_desktop="$(xdg-user-dir DESKTOP)"
radar_units="$HOME/.config/systemd/user"
radar_apps="$HOME/.local/share/applications"
mkdir -p "$radar_units" "$radar_apps" "$radar_desktop"
chmod +x "$radar_root/scripts/open-web.sh"
cat > "$radar_units/github-top.service" <<UNIT
[Unit]
Description=GitHub Top - Local Open Source Radar
After=network.target

[Service]
Type=simple
WorkingDirectory=$radar_root
ExecStart=$radar_node $radar_root/server/index.mjs
Environment=NODE_ENV=production
Environment=PORT=4317
Restart=on-failure
RestartSec=4
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=default.target
UNIT
cat > "$radar_apps/github-top.desktop" <<ENTRY
[Desktop Entry]
Version=1.0
Type=Application
Name=开源雷达 Web
GenericName=GitHub 热门项目看板
Comment=发现 GitHub 热门项目、收藏灵感，一键打开本地网页
Exec="$radar_root/scripts/open-web.sh"
Icon=$radar_root/public/icon.svg
Terminal=false
Categories=Development;
StartupNotify=false
Keywords=GitHub;开源;热门;趋势;Web;
ENTRY
cp "$radar_apps/github-top.desktop" "$radar_desktop/开源雷达 Web.desktop"
chmod +x "$radar_apps/github-top.desktop" "$radar_desktop/开源雷达 Web.desktop"
if command -v gio >/dev/null 2>&1; then gio set "$radar_desktop/开源雷达 Web.desktop" metadata::trusted true || true; fi
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$radar_apps"; fi
systemctl --user daemon-reload
systemctl --user enable github-top.service
printf '桌面入口已安装：%s\n' "$radar_desktop/开源雷达 Web.desktop"
