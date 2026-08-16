# TradingView 指标数据采集客户端

通过开放接口获取订阅配置，连接 TradingView WebSocket，在 K 线收盘时自动采集指标趋势线数据并回写到服务端数据库。

支持 **本地运行** 与 **Docker 运行** 两种方式，开放平台接口已封装为独立的 `OpenApiClient` 类，便于二次开发与复用。

## 项目结构

```
data_client/
├── clients/
│   └── tv-indicator.js     # TradingView 指标采集（多周期共振 v2.0）— 命令行入口
├── lib/
│   └── OpenApiClient.js    # 开放平台 API 封装类（fetchTvData/writeTvDataList/reportStatus/fetchLastDataList/fetchDataList）
├── mt5/
│   └── MT5Bridge.ex5       # MT5 桥接 EA（编译后的 MQL5 专家顾问，用于中继客户端与 MT5 终端通信）
├── package.json
├── .env.example            # 配置文件模板（复制为 .env 使用）
├── .gitignore
├── Dockerfile              # Docker 镜像构建（多阶段，非 root 运行）
├── docker-compose.yml      # Docker Compose 一键编排
├── .dockerignore
└── README.md
```

## 前置条件

- **Node.js >= 18**（使用内置 `fetch`）—— 仅本地运行需要
- **Docker >= 20.10** + **Docker Compose v2** —— 仅 Docker 运行需要
- 后端服务已启动（默认 `http://127.0.0.1:7000`）
- 已在管理后台创建以下数据：
  - **TV 用户配置**（`bot_tv_user`）：含 `session_id`、`session_sign`、`indicator_id`
  - **数据源订阅**（`bot_tv_data`）：关联上述 TV 用户，配置交易所/币种/周期/K线类型
  - **访问密钥**（`bot_api_key`）：用于开放接口 Bearer Token 鉴权

## 获取项目

项目已同步发布到 GitHub 与 Gitee，按网络情况任选其一克隆：

```bash
# GitHub（海外网络）
git clone https://github.com/<your-account>/tradingbot-data-client.git
cd tradingbot-data-client

# Gitee（国内网络，速度更快）
git clone https://gitee.com/<your-account>/tradingbot-data-client.git
cd tradingbot-data-client
```

> 请将 `<your-account>` 替换为实际仓库账号。后续更新可直接 `git pull` 拉取最新版本。

## 配置

复制配置模板并填写实际值：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
# 开放接口地址（后端服务地址）
# 默认写死为正式服务器：https://trader.aigcplus.vip
# Docker 运行时若后端在宿主机，可填 http://host.docker.internal:7000 覆盖
API_URL=https://trader.aigcplus.vip

# 访问密钥（bot_api_key 表中的 api_key）
# 也可通过命令行 -k 传入，命令行优先级更高
API_KEY=

# 数据源ID（bot_tv_data 表的自增 id）
# 该 ID 对应的数据源可关联 TV 用户（target_type=1）或交易所账号（target_type=2）
# 也可通过命令行 -i 传入，命令行优先级更高
TV_DATA_ID=

# 价格保留小数位数（默认 2）
PRICE_PRECISION=2
```

## 运行方式一：本地运行

### 安装依赖

```bash
npm install
```

> 依赖 `@mathieuc/tradingview` 来自 GitHub，需要本机已安装 `git`。

### 启动

```bash
# 方式一：全部从 .env 读取（需在 .env 中填写 API_KEY 和 TV_DATA_ID）
node clients/tv-indicator.js

# 方式二：命令行传参（覆盖 .env 中的值）
node clients/tv-indicator.js -k <api_key> -i <tv_data_id>

# 混合使用：.env 配置 API_URL，命令行传入 api_key 和 tv_data_id
node clients/tv-indicator.js -k abc123def456 -i 1

# 方式三：通过 npm script（等价于方式一）
npm start
```

### 查看帮助

```bash
node clients/tv-indicator.js -h
# 或
npm run help
```

## 运行方式二：Docker 运行（推荐生产环境）

### 方式 A：Docker Compose 一键启动（推荐）

```bash
# 1. 已通过 cp .env.example .env 配置好 .env（填写 API_KEY / TV_DATA_ID）
# 2. 构建并后台启动
docker compose up -d --build

# 3. 查看实时日志
docker compose logs -f

# 4. 停止
docker compose down

# 5. 更新代码后重新构建
git pull && docker compose up -d --build
```

### 方式 B：docker 命令直接运行

```bash
# 构建镜像
docker build -t tradingbot-data-client:latest .

# 运行容器（通过 -e 注入配置，无需 .env 文件）
docker run -d \
  --name tradingbot-data-client \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -e API_URL=https://trader.aigcplus.vip \
  -e API_KEY=your_api_key \
  -e TV_DATA_ID=1 \
  -e PRICE_PRECISION=2 \
  tradingbot-data-client:latest

# 查看日志
docker logs -f tradingbot-data-client

# 停止并删除
docker stop tradingbot-data-client && docker rm tradingbot-data-client
```

### Docker 网络说明

| 后端位置 | API_URL 取值 |
|---------|-------------|
| 正式服务器（默认） | `https://trader.aigcplus.vip`（已写死为默认值，无需额外配置） |
| 宿主机本地（非容器） | `http://host.docker.internal:7000`（Linux 需加 `--add-host host.docker.internal:host-gateway`） |
| 同一 Docker 网络 | `http://<后端服务名>:7000`（需将本服务加入后端所在网络） |
| 公网/远程 | 直接填公网地址 |

## 参数说明

| 来源 | 参数 | 说明 | 必填 | 默认值 |
|------|------|------|------|--------|
| `.env` | `API_URL` | 开放接口地址 | 否 | `https://trader.aigcplus.vip` |
| `.env` / `-k` | `API_KEY` / `--api-key` | `bot_api_key` 表中的 api_key | 是 | — |
| `.env` / `-i` | `TV_DATA_ID` / `--tv-data-id` | `bot_tv_data` 表的自增 id（可关联 TV 用户或交易所账号） | 是 | — |
| `.env` / `-p` | `PRICE_PRECISION` / `--price-precision` | 价格保留小数位数 | 否 | `2` |
| — | `-d` / `--debug` | 打印指标加载原始入参/出参 | 否 | 关闭 |

> 命令行参数优先级高于 `.env`，方便临时切换数据源而不修改配置文件。
> Docker 运行时通过 `-e` 或 `env_file` 注入等价环境变量。

## OpenApiClient 类用法

开放平台接口已封装到 [lib/OpenApiClient.js](lib/OpenApiClient.js)，可在自己的脚本中独立复用：

```js
const { OpenApiClient } = require('./lib/OpenApiClient');

const client = new OpenApiClient({
  apiUrl: 'https://trader.aigcplus.vip',
  apiKey: 'your_api_key',
});

// 1. 获取数据源订阅配置 + TV 用户凭证
const { tv_data, tv_user } = await client.fetchTvData(1);

// 2. 写入 K 线收盘指标数据
await client.writeTvDataList({
  tv_data_id: 1,
  data: JSON.stringify({ m15_duo: 100.5, h1_kong: 101.2 }),
  kline_time: Date.now(),
  price: '100.80',
});

// 3. 上报运行状态（0=停止, 1=运行中, 2=异常）
await client.reportStatus(1, 1, '');

// 4. 获取最后一条数据记录（无数据时返回空对象）
const last = await client.fetchLastDataList(1);

// 5. 获取最近若干条记录（默认 10 条，最大 100 条，按 id 降序）
const list = await client.fetchDataList(1, 10);
```

## 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端启动流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 读取 .env 配置 + 解析命令行参数（命令行覆盖 .env）         │
│                                                             │
│  2. GET /api/open/tvData/:id                                │
│     └─ 获取 bot_tv_data 订阅配置 + 关联目标凭证              │
│        ├─ target_type=1 → tv_user 含 TV session/sign/indicator │
│        ├─ target_type=2 → target(交易所账号) 含 TV 凭证       │
│        ├─ tvData.exchange/symbol   → 交易所/币种             │
│        └─ tvData.timeframe/chart_type → 周期/K线类型         │
│                                                             │
│  3. 连接 TradingView WebSocket                              │
│     └─ 订阅指标，等待数据就绪                                 │
│                                                             │
│  4. K 线收盘时（检测到时间戳变化）                             │
│     ├─ 控制台打印趋势线数据                                   │
│     └─ POST /api/open/tvDataList/write                      │
│        └─ 写入 bot_tv_data_list                             │
│           ├─ tv_data_id: 数据源 id                           │
│           ├─ data: 趋势线 JSON（cur/m10/m15/m30/h1/h2/h4…）  │
│           ├─ kline_time: K线收盘毫秒时间戳                    │
│           └─ price: 当前价格                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 采集的趋势线时间级别

| 字段 | 含义 |
|------|------|
| `cur` | 当前周期 |
| `m10` | 10 分钟 |
| `m15` | 15 分钟 |
| `m30` | 30 分钟 |
| `h1` | 1 小时 |
| `h2` | 2 小时 |
| `h4` | 4 小时 |
| `h8` | 8 小时 |
| `h12` | 12 小时 |
| `d1` | 1 天 |
| `d2` | 2 天 |
| `d3` | 3 天 |
| `d5` | 5 天 |

> 变量名按趋势方向加后缀：做多 `_duo`，做空 `_kong`（如 `m15_duo`、`h1_kong`）。

## 依赖的开放接口

| 接口 | 方法 | 说明 | 封装方法 |
|------|------|------|---------|
| `/api/open/tvData/:id` | `GET` | 获取数据源订阅配置 + 关联目标凭证（TV用户或交易所账号） | `OpenApiClient.fetchTvData()` |
| `/api/open/tvDataList/write` | `POST` | 写入 K 线收盘指标数据 | `OpenApiClient.writeTvDataList()` |
| `/api/open/tvData/:id/status` | `POST` | 上报数据源运行状态 | `OpenApiClient.reportStatus()` |
| `/api/open/tvDataList/lastDataList` | `GET` | 获取指定数据源最后一条记录（query: `tv_data_id`） | `OpenApiClient.fetchLastDataList()` |
| `/api/open/tvDataList/list` | `GET` | 获取指定数据源最近若干条记录（query: `tv_data_id`、`limit`，limit 1~100） | `OpenApiClient.fetchDataList()` |

五个接口均需在请求头携带 `Authorization: Bearer <api_key>`。

## 容错机制

- **获取配置失败**：指数退避重试（5s → 10s → 20s → … 最长 60s）
- **WebSocket 断连**：5 秒后自动重新连接
- **数据写入失败**：仅打印错误日志，不影响采集进程
- **30 秒未获取到数据**：自动重新初始化连接
- **Docker 异常退出**：`restart: unless-stopped` 自动拉起

## 退出

- **本地运行**：按 `Ctrl + C` 发送 `SIGINT`，客户端清理 WebSocket 连接后退出
- **Docker 运行**：`docker compose down` 或 `docker stop tradingbot-data-client`

## MT5 桥接（MetaTrader 5 集成）

### 什么是 MT5

**MetaTrader 5（MT5）** 是由 MetaQuotes Software 公司开发的专业级金融交易平台，广泛应用于外汇、差价合约（CFD）、期货、股票和加密货币等市场的交易。MT5 是 MetaTrader 4 的升级版本，提供更强大的分析功能、更丰富的订单类型和更高效的执行速度。

**核心特性：**

- **多资产支持**：一个账户可交易外汇、股票、期货、加密货币等多种品种
- **高级图表与分析**：内置 21 种时间周期、80+ 技术指标和多种分析工具
- **算法交易（EA）**：支持通过 MQL5 编写的 Expert Advisor（专家顾问）实现自动交易
- **多线程回测**：内置策略测试器，支持历史数据回测和参数优化
- **深度市场数据**：提供 Level 2 报价、成交深度和市场情绪数据

### MT5Bridge.ex5 是什么

`mt5/MT5Bridge.ex5` 是一个**编译后的 MQL5 Expert Advisor（EA）文件**，作为中继客户端（Relay Client）与 MT5 终端之间的桥接程序。

**工作原理（文件桥接模式）：**

```
中继客户端（Python）              MT5 终端（EA）
       │                              │
       │  写入 bridge_in.json         │
       ├─────────────────────────────▶│ EA 的 OnTick/OnTimer 读取指令
       │                              │ 执行交易（下单/平仓/查询）
       │  读取 bridge_out.json        │
       │◀─────────────────────────────┤ EA 将结果写入 bridge_out.json
       │                              │
       │  读取 bridge_status.json     │
       │◀─────────────────────────────┤ EA 定期写入运行状态
```

**桥接文件说明：**

| 文件 | 方向 | 作用 |
|------|------|------|
| `bridge_in.json` | Python 写 / EA 读 | 交易指令（下单、平仓、查询账户/持仓等） |
| `bridge_out.json` | EA 写 / Python 读 | 交易执行结果（成交价、订单号、错误信息等） |
| `bridge_status.json` | EA 写 / Python 读 | EA 运行状态（online/offline、账户信息） |

> 三个文件均位于 MT5 终端的公共文件目录（Common\Files），EA 使用 `FILE_COMMON` 标志写入。

### 客户如何使用 MT5

如果客户希望通过 MT5 终端进行自动交易，请按以下步骤操作：

#### 1. 安装 MT5 终端

从 [MetaQuotes 官网](https://www.metaquotes.net/cn/metatrader5) 或客户所属券商官网下载并安装 MT5 终端。Windows 系统是 MT5 的主要支持平台。

#### 2. 部署桥接 EA

将 `mt5/MT5Bridge.ex5` 文件复制到 MT5 终端的 Experts（专家顾问）目录：

```
<MT5安装目录>\MQL5\Experts\
```

> 也可在 MT5 终端菜单中选择 **文件 → 打开数据文件夹**，进入 `MQL5\Experts` 目录粘贴。

#### 3. 启用 EA 自动交易

1. 打开 MT5 终端，在顶部工具栏确认 **算法交易**（AutoTrading）按钮已开启（绿色）
2. 在 **导航器** 面板中找到 `Expert Advisors` 下的 `MT5Bridge`
3. 将其拖拽到任意图表上，在弹出的对话框中：
   - 勾选 **允许实时自动交易**（Allow live trading）
   - 切换到 **通用** 选项卡，确认 EA 已加载

#### 4. 配置中继客户端

中继客户端（trader_client）启动后，会自动检测 MT5 终端的公共文件目录并建立通信：

- EA 加载后会写入 `bridge_status.json` 标记为 `online`
- 中继客户端轮询读取状态文件，确认 EA 在线后即可接收交易指令
- 所有交易通过 SaaS 平台 → 中继客户端 → MT5Bridge EA → MT5 终端 的链路自动执行

#### 5. 验证连接

在 MT5 终端的 **专家** 面板中查看日志，正常启动会显示：

```
[MT5Bridge] EA 已启动
[MT5Bridge] Common Files 路径: ...\Common\Files\
[MT5Bridge] bridge_status.json 已写入
```

> 如需查看详细的 MT5 配置图文教程，请访问帮助中心的 [MT5 接入指南](https://help.aigcplus.vip)。

### 注意事项

- `MT5Bridge.ex5` 为**编译后的二进制文件**，无需安装 MQL5 编译器即可直接使用
- 一个 MT5 终端只需挂载一个 EA 实例，可同时处理多品种交易指令
- EA 运行期间请保持 MT5 终端登录状态，终端关闭或断线将导致交易中断
- 建议在 MT5 终端的 **工具 → 选项 → 专家顾问** 中勾选 **允许算法交易**，并确认 DLL 导入权限设置正确

## 发布到 GitHub / Gitee（维护者参考）

若需自行发布维护，可参考以下步骤将本项目作为独立仓库托管：

```bash
# 1. 在 GitHub / Gitee 上新建空仓库（如 tradingbot-data-client）
# 2. 在本目录初始化并推送
git init
git add .
git commit -m "init: TradingView 指标数据采集客户端"
git branch -M main

# 推送到 GitHub
git remote add origin https://github.com/<your-account>/tradingbot-data-client.git
git push -u origin main

# 同时推送到 Gitee（同一仓库多远程）
git remote add gitee https://gitee.com/<your-account>/tradingbot-data-client.git
git push -u gitee main

# 后续同步双端
git push origin main && git push gitee main
```

> `.env` 已在 `.gitignore` 中忽略，密钥不会泄露。客户克隆后通过 `.env.example` 创建自己的 `.env`。
