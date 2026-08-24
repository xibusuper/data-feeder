/**
 * TradingView 指标数据采集客户端
 *
 * 从开放接口 /api/open/ 获取订阅配置，K线收盘时将指标数据写回数据库：
 *   1. GET  /api/open/tvData/:id   → 获取 bot_tv_data 订阅配置 + bot_tv_user 凭证
 *   2. POST /api/open/tvDataList/write → K线收盘时将指标数据写入 bot_tv_data_list
 *
 * 开放平台接口调用统一封装在 lib/OpenApiClient.js 中。
 * 配置来源：.env 文件（API_URL / API_KEY / TV_DATA_ID），命令行参数可覆盖
 *
 * 用法：
 *   node clients/tv-indicator.js -k <api_key> -i <tv_data_id>
 *   node clients/tv-indicator.js              （全部从 .env 读取）
 */
require('dotenv').config();
const TradingView = require('@mathieuc/tradingview');
const { OpenApiClient } = require('../lib/OpenApiClient');

const TIMEFRAMES = ['cur', 'm10', 'm15', 'm30', 'h1', 'h2', 'h4', 'h8', 'h12', 'd1', 'd2', 'd3', 'd5'];

let currentClient = null;
let currentChart = null;
let currentStudy = null;
let checkDataInterval = null;
let previousTime = null;

// ============ 命令行参数解析（.env 提供默认值，命令行可覆盖） ============
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    apiUrl: process.env.API_URL || 'https://trader.aigcplus.vip',
    apiKey: process.env.API_KEY || '',
    tvDataId: process.env.TV_DATA_ID || '',
    pricePrecision: Number(process.env.PRICE_PRECISION) || 2,
    debug: false,
  };
  args.forEach((arg, index) => {
    const next = args[index + 1];
    // 只有当下一个参数存在且不是另一个选项（不以 - 开头）时才作为值
    if (arg === '-k' || arg === '--api-key') {
      if (next && !next.startsWith('-')) config.apiKey = next;
    } else if (arg === '-i' || arg === '--tv-data-id') {
      if (next && !next.startsWith('-')) config.tvDataId = next;
    } else if (arg === '-p' || arg === '--price-precision') {
      if (next && !next.startsWith('-')) config.pricePrecision = Number(next);
    } else if (arg === '-d' || arg === '--debug') {
      config.debug = true;
    }
  });
  return config;
}

function printUsage() {
  console.log("TradingView 指标数据采集客户端（从开放接口获取配置）");
  console.log("");
  console.log("用法:");
  console.log("  node clients/tv-indicator.js -k <api_key> -i <tv_data_id>");
  console.log("  node clients/tv-indicator.js              （全部从 .env 读取）");
  console.log("");
  console.log("参数（均可通过 .env 配置，命令行优先级更高）:");
  console.log("  -k, --api-key         bot_api_key 表中的 api_key");
  console.log("  -i, --tv-data-id      bot_tv_data 表的自增 id");
  console.log("  -p, --price-precision 价格保留小数位数（默认: 2）");
  console.log("  -d, --debug           打印指标加载的原始入参/出参（调试用）");
  console.log("");
  console.log(".env 配置项:");
  console.log("  API_URL            开放接口地址（默认: https://trader.aigcplus.vip）");
  console.log("  API_KEY            访问密钥");
  console.log("  TV_DATA_ID         数据源ID");
  console.log("  PRICE_PRECISION    价格保留小数位数（默认: 2）");
  console.log("");
  console.log("示例:");
  console.log("  node clients/tv-indicator.js -k abc123def456 -i 1");
  console.log("  node clients/tv-indicator.js              （需在 .env 中配置 API_KEY 和 TV_DATA_ID）");
}

// ============ 开放接口调用 ============
// 开放平台接口（fetchTvData / writeTvDataList / reportStatus）已封装到
// lib/OpenApiClient.js 的 OpenApiClient 类中，主流程通过 openApi 实例调用。

// ============ 数据格式化与输出 ============
function formatMarket(exchange, symbol) {
  return `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;
}

/**
 * 从 TradingView period 对象中提取趋势线数据
 * @param period    TradingView period 对象
 * @param precision 价格保留小数位数
 * @param price     当前价格（用于判断多空方向）
 * 过滤 1e+100（无趋势哨兵值），并对有效值按 precision 四舍五入
 * 变量名按趋势方向加后缀：做多 _duo，做空 _kong（如 m15_duo、m10_kong）
 */
function extractTrendData(period, precision, price) {
  const p = precision || 2;
  const NO_DATA = 1e+100;
  const trendData = {};
  TIMEFRAMES.forEach((tf) => {
    const val = period[tf];
    if (val !== undefined && val !== null && val !== NO_DATA) {
      const formattedVal = Number(val.toFixed(p));
      if (price > 0) {
        // value < price → 做多(_duo)；value >= price → 做空(_kong)
        const suffix = val < price ? '_duo' : '_kong';
        trendData[`${tf}${suffix}`] = formattedVal;
      } else {
        trendData[tf] = formattedVal;
      }
    }
  });
  return trendData;
}

function printTrendData(data, price, klineTime, precision) {
  if (!data) {
    console.log("\n等待数据...");
    return;
  }

  const p = precision || 2;
  const NO_DATA = 1e+100; // TradingView 无趋势哨兵值
  const fmt = (v) => v.toFixed(p);

  console.log("\n" + "=".repeat(50));
  const localNow = new Date();
  console.log(`K线收盘时间(TV): ${new Date(klineTime * 1000).toLocaleString()}`);
  console.log(`K线时间戳(TV): ${klineTime} (秒) | ${klineTime * 1000} (毫秒)`);
  console.log(`本地当前时间: ${localNow.toLocaleString()}`);
  console.log(`本地时间戳: ${Math.floor(localNow.getTime() / 1000)} (秒) | ${localNow.getTime()} (毫秒)`);
  console.log(`当前价格: ${price > 0 ? fmt(price) : price}`);

  console.log("\n=== 时间级别趋势线值 ===");
  console.log("时间级别 | 趋势线值 | 与价格差值 | 趋势方向");
  console.log("---------|-----------|------------|----------");

  const trendResults = [];
  TIMEFRAMES.forEach((tf) => {
    if (data[tf] !== undefined && data[tf] !== null) {
      const value = data[tf];
      const isNoData = value === NO_DATA;
      let diff = '-';
      let direction = '无趋势';
      let displayValue = '-';

      if (!isNoData && price > 0) {
        displayValue = fmt(value);
        diff = (value - price).toFixed(p);
        direction = value < price ? '做多' : '做空';
      }

      trendResults.push({ tf, value, displayValue, diff, direction, isNoData });
    }
  });

  trendResults.forEach((r) => {
    console.log(`${r.tf.padEnd(8)} | ${r.displayValue.padStart(10)} | ${r.diff.padStart(10)} | ${r.direction.padStart(6)}`);
  });

  console.log("\n=== 多空汇总 ===");
  const buyTfs = trendResults.filter(r => r.direction === '做多');
  const sellTfs = trendResults.filter(r => r.direction === '做空');

  console.log(`做多趋势 (${buyTfs.length}个):`);
  buyTfs.forEach(r => console.log(`  ${r.tf}: ${r.displayValue}`));

  console.log(`\n做空趋势 (${sellTfs.length}个):`);
  sellTfs.forEach(r => console.log(`  ${r.tf}: ${r.displayValue}`));

  console.log("=".repeat(50));
}

// ============ 资源清理 ============
function cleanupResources() {
  if (checkDataInterval) {
    clearInterval(checkDataInterval);
    checkDataInterval = null;
  }
  if (currentStudy) {
    try { currentStudy.remove(); } catch (e) {}
    currentStudy = null;
  }
  if (currentChart) {
    try { currentChart.delete(); } catch (e) {}
    currentChart = null;
  }
  if (currentClient) {
    try { currentClient.end(); } catch (e) {}
    currentClient = null;
  }
}

// ============ 主逻辑 ============
async function initClient(apiConfig, tvData, tvCredentials) {
  cleanupResources();
  previousTime = null;

  const sessionId = tvCredentials.tv_session_id;
  const sessionSign = tvCredentials.tv_session_sign;
  const indicatorScriptId = tvCredentials.tv_indicator_id;

  const exchange = tvData.exchange;
  const symbol = tvData.symbol;
  const timeframe = String(tvData.timeframe);
  const chartType = tvData.chart_type || 'regular';
  const tvDataId = tvData.id;

  const market = formatMarket(exchange, symbol);

  console.log(`\n=== 初始化指标: ${indicatorScriptId} ===`);
  console.log(`数据源ID: ${tvDataId} | 名称: ${tvData.name || ''}`);
  console.log(`交易所: ${exchange}`);
  console.log(`币种: ${symbol}`);
  console.log(`周期: ${timeframe}分钟`);
  console.log(`K线类型: ${chartType === 'heikin' ? '平均K线(Heikin Ashi)' : '普通K线'}`);
  console.log(`TV凭证来源: ${tvCredentials.name || ''} (ID:${tvCredentials.id})`);
  console.log("模式: K线收盘时自动输出数据并写入开放接口");

  try {
    // ===== 调试：打印 getIndicator 的原始入参（仅 -d/--debug 时输出）=====
    if (apiConfig.debug) {
      console.log("\n--- [调试] getIndicator 入参 ---");
      console.log("  scriptId :", indicatorScriptId);
      console.log("  version  :", "last");
      console.log("  sessionId:", sessionId);
    }

    const indicator = await TradingView.getIndicator(indicatorScriptId, 'last', sessionId);
    console.log("指标名称:", indicator.shortDescription);

    // ===== 调试：打印 getIndicator 的原始出参（仅 -d/--debug 时输出）=====
    if (apiConfig.debug) {
      console.log("\n--- [调试] getIndicator 出参（指标元信息）---");
      console.log("  shortDescription:", indicator.shortDescription);
      console.log("  description     :", indicator.description);
      console.log("  pineId          :", indicator.pineId);
      // 打印指标的所有可用输入参数定义（兼容数组/对象）
      if (indicator.inputs) {
        console.log("\n  === 指标输入参数定义 (inputs) ===");
        if (Array.isArray(indicator.inputs)) {
          indicator.inputs.forEach((input, idx) => {
            console.log(`  [${idx}]:`, JSON.stringify(input));
          });
        } else {
          // 对象格式：{ in_0: {...}, in_1: {...}, ... }
          Object.entries(indicator.inputs).forEach(([key, input]) => {
            console.log(`  [${key}]:`, JSON.stringify(input));
          });
        }
      }
      // 打印当前选项值（即各输入参数的当前值）
      if (indicator.options) {
        console.log("\n  === 当前输入参数值 (options) ===");
        console.log(JSON.stringify(indicator.options, null, 4));
      }
      // 打印指标的所有输出定义
      if (indicator.plots) {
        console.log("\n  === 指标输出定义 (plots) ===");
        if (Array.isArray(indicator.plots)) {
          indicator.plots.forEach((plot, idx) => {
            console.log(`  [${idx}] id=${plot.id} type=${plot.type} target=${plot.target || ''}`);
          });
        } else {
          console.log(JSON.stringify(indicator.plots, null, 4));
        }
      }
      // 完整对象（用于深度排查，排除可能的循环引用）
      console.log("\n  === 完整指标对象（JSON）===");
      try {
        console.log(JSON.stringify(indicator, (key, val) => (typeof val === 'function' ? '[Function]' : val), 2));
      } catch (e) {
        console.log("  (序列化失败，改用 Object.keys 列出属性:)");
        console.log("  keys:", Object.keys(indicator));
      }
      console.log("--- [调试] 结束 ---\n");

      // 修改指标入参示例（调试时取消注释使用）：
      //   indicator.setOption('Length', 14);        // 修改周期长度
      //   indicator.setOption('Source', 'close');   // 修改数据源
      //   indicator.setOption('Multiplier', 2.0);   // 修改乘数
      // 具体可用的参数名见上方 "指标输入参数定义" 输出
    }

    // ===== 打开默认关闭的时间级别开关 =====
    // 参数名对应 indicator.inputs 的 key（in_55 / in_63 / in_71 ...）
    // 每个时间级别的第一组参数中 name="显示" type="bool" 的即为开关
    indicator.setOption('in_55', true);  // h8  (8小时) 显示
    indicator.setOption('in_63', true);  // h12 (12小时) 显示
    indicator.setOption('in_71', true);  // d1  (1日) 显示

    currentClient = new TradingView.Client({
      token: sessionId,
      signature: sessionSign,
    });

    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 8000);
      currentClient.onConnected(() => {
        clearTimeout(timeout);
        console.log("\n客户端连接成功!");
        apiConfig.openApi.reportStatus(tvDataId, 1);
        resolve();
      });
    });

    currentChart = new currentClient.Session.Chart();
    const marketOptions = { timeframe, range: 20 };
    if (chartType === 'heikin') {
      marketOptions.type = 'HeikinAshi';
    }
    currentChart.setMarket(market, marketOptions);

    let currentPrice = 0;
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 15000);
      currentChart.onSymbolLoaded(() => {
        clearTimeout(timeout);
        console.log(`市场: ${currentChart.infos.description}`);
        resolve();
      });
      currentChart.onUpdate(() => {
        if (currentChart.periods && currentChart.periods[0]) {
          currentPrice = currentChart.periods[0].close;
        }
      });
    });

    console.log("添加指标...");
    currentStudy = new currentChart.Study(indicator);

    currentStudy.onReady(() => {
      console.log("指标准备就绪!");
      console.log(`等待 ${timeframe} 分钟K线收盘...`);
    });

    currentStudy.onUpdate(() => {
      if (!currentStudy.periods || currentStudy.periods.length === 0) return;

      const currentPeriod = currentStudy.periods[0];
      const currentTime = currentPeriod.$time;

      // K线收盘：previousTime 变化意味着上一根已收盘
      if (previousTime !== null && previousTime !== currentTime) {
        const closedPeriod = currentStudy.periods[1];
        if (closedPeriod) {
          handleKlineClose(apiConfig, tvDataId, closedPeriod, currentPrice);
        }
      }

      previousTime = currentTime;
    });

    let retries = 0;
    checkDataInterval = setInterval(() => {
      retries++;
      if (retries > 30) {
        clearInterval(checkDataInterval);
        checkDataInterval = null;
        console.log("\n=== 未获取到数据，尝试重新连接 ===");
        apiConfig.openApi.reportStatus(tvDataId, 2, '未获取到数据，超时重连');
        setTimeout(() => initClient(apiConfig, tvData, tvCredentials), 5000);
        return;
      }

      if (currentStudy.periods && currentStudy.periods[0]) {
        clearInterval(checkDataInterval);
        checkDataInterval = null;
        previousTime = currentStudy.periods[0].$time;
        console.log("\n=== 数据获取成功，等待K线收盘 ===");
        apiConfig.openApi.reportStatus(tvDataId, 1);
      }
    }, 1000);

    currentClient.onError((err) => {
      console.error("\nWebSocket 错误:", err);
      console.log("尝试重新连接...");
      apiConfig.openApi.reportStatus(tvDataId, 2, `WebSocket错误: ${JSON.stringify(err)}`);
      cleanupResources();
      setTimeout(() => initClient(apiConfig, tvData, tvCredentials), 5000);
    });

  } catch (err) {
    console.error("\n初始化失败:", err.message);
    console.log("尝试重新连接...");
    apiConfig.openApi.reportStatus(tvDataId, 2, `初始化失败: ${err.message}`);
    setTimeout(() => initClient(apiConfig, tvData, tvCredentials), 5000);
  }
}

/**
 * K线收盘处理：打印趋势数据 + 写入开放接口
 */
async function handleKlineClose(apiConfig, tvDataId, closedPeriod, price) {
  const klineTimeSec = closedPeriod.$time; // TV 返回秒级时间戳
  const klineTimeMs = klineTimeSec * 1000; // DB 存毫秒
  const precision = apiConfig.pricePrecision || 2;

  // 控制台输出
  printTrendData(closedPeriod, price, klineTimeSec, precision);

  // 提取趋势线数据，序列化为 JSON 字符串写入 data 字段
  // 过滤1e+100，按precision格式化，变量名按多空方向加 _duo/_kong 后缀
  const trendData = extractTrendData(closedPeriod, precision, price);
  const payload = {
    tv_data_id: tvDataId,
    data: JSON.stringify(trendData),
    kline_time: klineTimeMs,
    price: price > 0 ? price.toFixed(precision) : String(price),
  };

  try {
    await apiConfig.openApi.writeTvDataList(payload);
    console.log(`[写入成功] tv_data_id=${tvDataId} kline_time=${klineTimeMs} price=${payload.price}`);
  } catch (err) {
    console.error(`[写入失败] ${err.message}`);
  }
}

// ============ 启动入口 ============
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  printUsage();
  process.exit(0);
}

const apiConfig = parseArgs();

if (!apiConfig.apiKey) {
  console.error("\x1b[31m[错误]\x1b[0m 缺少 api_key，请通过 -k/--api-key 传入或在 .env 中配置 API_KEY");
  printUsage();
  process.exit(1);
}
if (!apiConfig.tvDataId) {
  console.error("\x1b[31m[错误]\x1b[0m 缺少数据源 id，请通过 -i/--tv-data-id 传入或在 .env 中配置 TV_DATA_ID");
  printUsage();
  process.exit(1);
}

// 创建开放平台 API 客户端实例（封装 fetchTvData/writeTvDataList/reportStatus）
apiConfig.openApi = new OpenApiClient({
  apiUrl: apiConfig.apiUrl,
  apiKey: apiConfig.apiKey,
});

process.on('SIGINT', () => {
  console.log("\n收到中断信号，正在关闭连接...");
  // 同步上报状态为待运行（不阻塞退出）
  apiConfig.openApi.reportStatus(apiConfig.tvDataId, 0, '手动停止');
  cleanupResources();
  setTimeout(() => process.exit(0), 500);
});

// 启动：先从开放接口获取配置，再初始化 TradingView 客户端
(async () => {
  let retryDelay = 5000;
  while (true) {
    try {
      console.log(`正在从开放接口获取数据源配置: ${apiConfig.apiUrl}/api/open/tvData/${apiConfig.tvDataId}`);
      const result = await apiConfig.openApi.fetchTvData(apiConfig.tvDataId);
      console.log('\n=== 服务端返回 JSON ===');
      console.log(JSON.stringify(result, null, 2));
      console.log('======================\n');
      const tvData = result.tv_data;
      const tvUser = result.tv_user;
      const target = result.target;

      if (!tvData) {
        console.error("\x1b[31m[错误]\x1b[0m 数据源不存在");
        process.exit(1);
      }

      // 兼容两种 target_type：
      //   target_type=1 → tv_user 含 TV session/indicator 凭证
      //   target_type=2 → target 为交易所账号，需从中提取 TV 凭证
      let tvCredentials = null;
      if (tvUser) {
        tvCredentials = {
          tv_session_id: tvUser.tv_session_id,
          tv_session_sign: tvUser.tv_session_sign,
          tv_indicator_id: tvUser.tv_indicator_id,
          name: tvUser.name,
          id: tvUser.id,
        };
      } else if (target) {
        // 交易所账号作为目标：TV 凭证可能在 target 上，也可能在 tv_data 上
        tvCredentials = {
          tv_session_id: target.tv_session_id || tvData.tv_session_id,
          tv_session_sign: target.tv_session_sign || tvData.tv_session_sign,
          tv_indicator_id: target.tv_indicator_id || tvData.tv_indicator_id || tvData.indicator_name,
          name: target.name || tvData.name,
          id: target.id,
        };
      }

      if (!tvCredentials) {
        console.error("\x1b[31m[错误]\x1b[0m 关联的 TV 用户或交易所账号不存在");
        process.exit(1);
      }
      if (!tvCredentials.tv_session_id || !tvCredentials.tv_session_sign || !tvCredentials.tv_indicator_id) {
        console.error("\x1b[31m[错误]\x1b[0m TV 凭证不完整（缺少 session_id / session_sign / indicator_id）");
        process.exit(1);
      }

      retryDelay = 5000; // 重置重试间隔
      await initClient(apiConfig, tvData, tvCredentials);
      break; // initClient 内部自行处理重连，不需要外层循环
    } catch (err) {
      // 401/403 为永久性鉴权/权限错误，重试永远不会成功，直接退出
      if (err && (err.httpStatus === 401 || err.httpStatus === 403)) {
        console.error(`\n\x1b[31m[致命错误]\x1b[0m ${err.message}（HTTP ${err.httpStatus}）`);
        console.error('鉴权或权限错误不可重试，请检查 -k/--api-key 是否正确、以及与 -i/--tv-data-id 归属是否一致。');
        process.exit(1);
      }
      console.error(`\n获取配置失败: ${err.message}，${retryDelay / 1000}秒后重试...`);
      await new Promise((r) => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 60000); // 指数退避，最长 60 秒
    }
  }
})();
