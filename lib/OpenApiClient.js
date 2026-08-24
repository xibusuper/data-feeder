/**
 * 开放平台 API 客户端
 *
 * 将后端 /api/open/* 接口统一封装为一个类，便于在采集脚本或其他场景中复用。
 *
 * 封装接口（均需 Bearer Token 鉴权）：
 *   1. GET  /api/open/tvData/:id              获取数据源订阅配置 + TV 用户凭证
 *   2. POST /api/open/tvDataList/write        写入 K 线收盘指标数据
 *   3. POST /api/open/tvData/:id/status       上报数据源运行状态
 *   4. GET  /api/open/tvDataList/lastDataList 获取指定数据源最后一条记录
 *   5. GET  /api/open/tvDataList/list         获取指定数据源最近若干条记录
 *
 * 用法：
 *   const { OpenApiClient } = require('./lib/OpenApiClient');
 *   const client = new OpenApiClient({ apiUrl: 'https://trader.aigcplus.vip', apiKey: 'xxx' });
 *   const { tv_data, tv_user } = await client.fetchTvData(1);
 *   await client.writeTvDataList({ tv_data_id: 1, data: '{}', kline_time: Date.now(), price: '100.00' });
 *   await client.reportStatus(1, 1, '');
 *   const last = await client.fetchLastDataList(1);
 *   const list = await client.fetchDataList(1, 10);
 */
/**
 * 开放平台 API 错误：携带 HTTP 状态码与业务 code，便于调用方区分
 * 永久性鉴权错误（401/403）与可重试的临时错误（网络/5xx/业务错误）。
 */
class OpenApiError extends Error {
  constructor(message, { httpStatus = 0, code = 0, action = '' } = {}) {
    super(message);
    this.name = 'OpenApiError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.action = action;
  }

  /** 是否为不可重试的鉴权/权限错误（401/403） */
  isAuthError() {
    return this.httpStatus === 401 || this.httpStatus === 403;
  }
}

class OpenApiClient {
  /**
   * @param {Object} options
   * @param {string} [options.apiUrl]  开放接口地址（默认: https://trader.aigcplus.vip）
   * @param {string} options.apiKey  bot_api_key 表中的 api_key
   * @param {number} [options.timeout=15000] 请求超时（毫秒）
   */
  constructor({ apiUrl = 'https://trader.aigcplus.vip', apiKey, timeout = 15000 }) {
    if (!apiUrl) throw new Error('OpenApiClient: apiUrl 不能为空');
    if (!apiKey) throw new Error('OpenApiClient: apiKey 不能为空');
    // 去掉末尾斜杠，避免拼路径时出现双斜杠
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  /**
   * 构造带鉴权的请求头
   * @param {Object} [extra] 额外的请求头
   */
  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  /**
   * 统一响应解析：code !== 0 抛错，否则返回 data 字段
   * @param {Response} resp fetch 原始响应
   * @param {string} action 错误描述用
   */
  async _parse(resp, action) {
    let json;
    try {
      json = await resp.json();
    } catch (e) {
      throw new OpenApiError(`${action}失败：响应非 JSON (HTTP ${resp.status})`, { httpStatus: resp.status, action });
    }
    if (json.code !== 0) {
      throw new OpenApiError(json.msg || `${action}失败 (HTTP ${resp.status})`, {
        httpStatus: resp.status,
        code: json.code,
        action,
      });
    }
    return json.data;
  }

  /**
   * 1. 获取数据源订阅配置 + TV 用户凭证
   * GET /api/open/tvData/:id
   *
   * @param {number|string} tvDataId bot_tv_data 表的自增 id
   * @returns {Promise<{tv_data: Object, tv_user: Object, target: Object}>}
   */
  async fetchTvData(tvDataId) {
    const url = `${this.apiUrl}/api/open/tvData/${tvDataId}`;
    const resp = await fetch(url, {
      headers: this._headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    return this._parse(resp, '获取数据源');
  }

  /**
   * 2. 写入 K 线收盘指标数据
   * POST /api/open/tvDataList/write
   *
   * @param {Object} payload
   * @param {number|string} payload.tv_data_id  数据源 id
   * @param {string} payload.data              趋势线 JSON 字符串
   * @param {number} payload.kline_time        K 线收盘毫秒时间戳
   * @param {string} payload.price             当前价格（字符串）
   * @param {number} [payload.pid]             进程 pid（自动注入）
   * @returns {Promise<Object>} 写入记录
   */
  async writeTvDataList(payload) {
    const url = `${this.apiUrl}/api/open/tvDataList/write`;
    const body = { ...payload, pid: payload.pid ?? process.pid };
    const resp = await fetch(url, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });
    return this._parse(resp, '写入数据');
  }

  /**
   * 3. 上报数据源运行状态
   * POST /api/open/tvData/:id/status
   *
   * @param {number|string} tvDataId 数据源 id
   * @param {number} status          0=待运行(停止), 1=运行中, 2=异常
   * @param {string} [errorMessage=''] 异常信息
   * @param {number} [pid]           进程 pid（默认自动注入）
   * @returns {Promise<Object|null>} 失败时返回 null（不抛错，避免影响主流程）
   */
  async reportStatus(tvDataId, status, errorMessage = '', pid = process.pid) {
    try {
      const url = `${this.apiUrl}/api/open/tvData/${tvDataId}/status`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status, error_message: errorMessage, pid }),
        signal: AbortSignal.timeout(Math.min(this.timeout, 10000)),
      });
      return await this._parse(resp, '状态上报');
    } catch (err) {
      console.error(`[状态上报失败] ${err.message}`);
      return null;
    }
  }

  /**
   * 4. 获取指定数据源最后一条记录
   * GET /api/open/tvDataList/lastDataList?tv_data_id=
   *
   * @param {number|string} tvDataId 数据源 id
   * @returns {Promise<Object>} 最后一条记录（无数据时返回空对象）
   */
  async fetchLastDataList(tvDataId) {
    const url = `${this.apiUrl}/api/open/tvDataList/lastDataList?tv_data_id=${encodeURIComponent(tvDataId)}`;
    const resp = await fetch(url, {
      headers: this._headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    return this._parse(resp, '获取最后一条数据');
  }

  /**
   * 5. 获取指定数据源最近若干条记录
   * GET /api/open/tvDataList/list?tv_data_id=&limit=
   *
   * @param {number|string} tvDataId 数据源 id
   * @param {number} [limit=10]      返回条数（后端限制 1~100）
   * @returns {Promise<Object[]>} 记录数组（按 id 降序）
   */
  async fetchDataList(tvDataId, limit = 10) {
    const params = new URLSearchParams({
      tv_data_id: String(tvDataId),
      limit: String(limit),
    });
    const url = `${this.apiUrl}/api/open/tvDataList/list?${params.toString()}`;
    const resp = await fetch(url, {
      headers: this._headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    return this._parse(resp, '获取数据列表');
  }
}

module.exports = { OpenApiClient, OpenApiError };
