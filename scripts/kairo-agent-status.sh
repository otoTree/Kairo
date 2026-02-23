#!/bin/sh
# kairo-agent-status - waybar Agent 状态模块
# 查询 Kairo 内核的 Agent 运行状态
if pgrep -f "kairo-kernel" >/dev/null 2>&1; then
  echo "running"
else
  echo "offline"
fi
