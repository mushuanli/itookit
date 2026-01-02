#!/bin/bash
cd "$(dirname "$0")"

# 检查 Node
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed."
    echo "Please install Node.js (v18+) from https://nodejs.org/"
    read -p "Press enter to exit..."
    exit 1
fi

echo "🚀 Starting MindOS..."

# 打开浏览器 (等待1秒确保服务器启动)
(sleep 1 && (open "http://localhost:4173" 2>/dev/null || xdg-open "http://localhost:4173" 2>/dev/null)) &

# ✨ 启动我们生成的 server.js，而不是 npx serve
node server.js
