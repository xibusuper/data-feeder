# TradingView 指标数据采集客户端 Docker 镜像
# 多阶段构建：先用完整镜像安装依赖，再拷贝到精简镜像运行，减小最终体积

# ============ 阶段 1：安装依赖 ============
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# 先单独拷贝 package*.json，利用 Docker 层缓存
COPY package.json package-lock.json* ./
# @mathieuc/tradingview 来自 github，需要 git
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci --omit=dev || npm install --omit=dev

# ============ 阶段 2：运行时 ============
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# 运行时仅需 node，无需 git
# 创建非 root 用户运行，提升安全性
RUN groupadd --system appgroup && useradd --system --gid appgroup --create-home --home-dir /home/appuser appuser

# 拷贝已安装好的 node_modules
COPY --from=deps /app/node_modules ./node_modules
# 拷贝源码与配置示例
COPY clients ./clients
COPY lib ./lib
COPY package.json ./
COPY .env.example ./.env.example

# 默认不携带 .env，由用户挂载或通过 -e 注入
# 复制示例作为默认 .env（值为空，需用户覆盖）
RUN cp .env.example .env

USER appuser

# 健康检查：进程存活即健康（采集客户端为长驻进程，无 HTTP 端口）
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

# 采集客户端为长驻前台进程，CMD 直接启动
CMD ["node", "clients/tv-indicator.js"]
