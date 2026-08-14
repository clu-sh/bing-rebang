// 集成测试：在 Node 中用最小 DOM/jQuery 桩驱动整段 userscript（IIFE 黑盒），
// 验证频道下拉顺序、切换触发请求、超时/错误/空数据在右侧 #ex-user-msg 提示。
// 运行：node bing-rebang.user.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SCRIPT = fs.readFileSync(path.join(import.meta.dirname, "bing-rebang.user.js"), "utf8");
// 预编译一次（1389 行脚本每次 vm.runInContext 都重新编译是主要慢点之一）
const COMPILED = new vm.Script(SCRIPT, { filename: "bing-rebang.user.js" });

// 收集脚本内部创建的所有 timer，便于测试后统一清理，避免 setInterval 泄漏拖慢进程
const liveTimers = new Set();
const _setInterval = (fn, ms) => { const id = setInterval(fn, ms); liveTimers.add(id); return id; };
const _clearInterval = (id) => { clearInterval(id); liveTimers.delete(id); };

// ---------- 极简 DOM 桩 ----------

// HTML 片段：用于模拟 $('<div>...</div>') 创建的 jQuery 包装节点。
// 累积 append 进来的 HTML 字符串，toString 时拼接，便于断言外部容器 children。
class HtmlFrag {
  constructor(html) { this._html = html || ""; }
  get length() { return 1; }
  append(node) { this._html += typeof node === "string" ? node : String(node); return this; }
  on() { return this; }
  trigger() { return this; }
  val(v) { if (v !== undefined) { this._value = v; return this; } return this._value; }
  html(h) { if (h !== undefined) { this._html = h; return this; } return this._html; }
  text(t) { if (t !== undefined) { this._text = t; return this; } return this._text; }
  empty() { this._html = ""; return this; }
  find() { return makeNullJquery(); }
  before() { return this; }
  remove() { return this; }
  toggleClass() { return this; }
  addClass() { return this; }
  toString() { return this._html; }
}

function makeNullJquery() {
  const noop = () => makeNullJquery();
  return {
    length: 0,
    append: noop, on: noop, trigger: noop, val: noop, html: noop,
    text: noop, empty: noop, before: noop, remove: noop, toggleClass: noop, addClass: noop,
    find: noop,
    toString: () => "",
  };
}

class El {
  constructor(id) { this.id = id; this.children = []; this._html = ""; this._text = ""; this.value = null; this.classes = new Set(); this.handlers = {}; this.options = []; }
  get length() { return 1; }
  append(node) { this.children.push(node); if (node && typeof node === "object" && "value" in node) this.options.push(node); return this; }
  on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); return this; }
  trigger(evt, ev) { (this.handlers[evt] || []).forEach((f) => f.call(this, ev || { preventDefault() {}, key: undefined })); return this; }
  val(v) { if (v !== undefined) { this.value = v; return this; } return this.value; }
  html(h) { if (h !== undefined) { this._html = h; registerIdsFromHtml(h); return this; } return this._html; }
  text(t) { if (t !== undefined) { this._text = t; return this; } return this._text; }
  empty() { this.children = []; this._html = ""; return this; }
  before(h) { if (typeof h === "string") registerIdsFromHtml(h); return this; }
  remove() { delete els[this.id]; return this; }
  toggleClass(c, on) { if (on) this.classes.add(c); else this.classes.delete(c); return this; }
  addClass(c) { this.classes.add(c); return this; }
  find() { return makeNullJquery(); }
  toString() { return this._html; }
}

const els = {};
function registerIdsFromHtml(html) {
  const re = /id="([^"]+)"/g; let m;
  while ((m = re.exec(html))) { if (!els[m[1]]) els[m[1]] = new El(m[1]); }
}
function $(sel) {
  if (typeof sel === "object" && sel !== null) {
    // 已是正确的 jQuery 风格对象（真实环境里 $(this) 传入 DOM 元素，这里直接透传 El/HtmlFrag）
    return sel;
  }
  if (typeof sel === "string") {
    if (sel[0] === "#") {
      const el = els[sel.slice(1)];
      return el || makeNullJquery();
    }
    if (sel[0] === "<") {
      return new HtmlFrag(sel);
    }
  }
  return makeNullJquery();
}

// ---------- GM_xmlhttpRequest mock ----------
// responses: { [urlSubstr]: { action: 'load'|'timeout'|'error', status, body } }
let GM_CALLS = [];
function makeGmXml(responses) {
  return function GM_xmlhttpRequest(opts) {
    GM_CALLS.push(opts.url);
    const matched = Object.keys(responses).find((k) => opts.url.indexOf(k) >= 0);
    const r = matched ? responses[matched] : { action: "load", status: 200, body: "{}" };
    setTimeout(() => {
      if (r.action === "timeout") { if (opts.ontimeout) opts.ontimeout(); }
      else if (r.action === "error") { if (opts.onerror) opts.onerror(new Error("network")); }
      else if (r.status >= 200 && r.status < 300) { if (opts.onload) opts.onload({ status: r.status, responseText: r.body }); }
      else { if (opts.onload) opts.onload({ status: r.status, responseText: r.body }); }
    }, 0);
  };
}

const sandbox = {
  console,
  setTimeout,
  setInterval: _setInterval,
  clearInterval: _clearInterval,
  clearTimeout,
  Option: function (text, value) { this.text = text; this.value = value; },
  DOMParser: class { parseFromString() { return { querySelector: () => null, querySelectorAll: () => [] }; } },
  localStorage: null, // 在 runScript 中按测试重置，避免跨测试缓存串味
  sessionStorage: null,
};
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.top = sandbox;
sandbox.location = { host: "www.bing.com", href: "https://www.bing.com/search?q=test" };
sandbox.document = {
  readyState: "complete",
  hidden: false,
  cookie: "",
  body: new El("body"),
  getElementById: (id) => els[id] || null,
  createElement: (t) => new El(t),
  addEventListener: () => {},
};
sandbox.history = { pushState: () => {}, replaceState: () => {} };
sandbox.GM_addStyle = () => {};
const gmStore = new Map();
sandbox.GM_setValue = (k, v) => gmStore.set(k, v);
sandbox.GM_getValue = (k, d) => (gmStore.has(k) ? gmStore.get(k) : d);
sandbox.jQuery = $;
sandbox.window.addEventListener = () => {};
sandbox.window.scrollTo = () => {};
sandbox.window.focus = () => {};

function runScript(responses) {
  // 重置环境（每个测试隔离，避免 localStorage 缓存跨用例串味）
  for (const k of Object.keys(els)) delete els[k];
  GM_CALLS = [];
  sandbox.localStorage = makeStorage();
  sandbox.sessionStorage = makeStorage();
  els["b_content"] = new El("b_content");
  sandbox.GM_xmlhttpRequest = makeGmXml(responses);
  const ctx = vm.createContext(sandbox);
  COMPILED.runInContext(ctx);
  return sandbox;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 测试 ----------
test("下拉：需登录源排在最后（login 标记，不再显示后缀）", async () => {
  runScript({});
  const sel = els["ext-channels"];
  assert.ok(sel, "应存在 #ext-channels");
  const opts = sel.options;
  assert.ok(opts.length >= 13, "应至少有 13 个平台选项，实际 " + opts.length);
  const last = opts[opts.length - 1];
  const secondLast = opts[opts.length - 2];
  assert.equal(last.text, "小红书", "最后应为小红书（无后缀）");
  assert.equal(secondLast.text, "微博", "倒数第二应为微博（无后缀）");
  assert.equal(last.value, "小红书");
  assert.equal(secondLast.value, "微博");
});

test("切换频道会发起对应源的请求", async () => {
  const responses = {
    "api.zhihu.com": { action: "load", status: 200, body: JSON.stringify({ data: [] }) },
  };
  runScript(responses);
  await delay(5);
  const before = GM_CALLS.length;
  const sel = els["ext-channels"];
  sel.value = "知乎";
  sel.trigger("change");
  await delay(20);
  assert.ok(GM_CALLS.length > before, "切换后应触发新的 GM_xmlhttpRequest");
  assert.ok(GM_CALLS.some((u) => u.indexOf("api.zhihu.com") >= 0), "应请求知乎接口: " + GM_CALLS.join(","));
});

test("返回正常数据时右侧无错误提示且列表渲染", async () => {
  // 微博为 JSON 接口，且已放宽授权（无 Cookie 也可），用有效 JSON 测试
  const responses = {
    "m.weibo.cn": {
      action: "load", status: 200,
      body: JSON.stringify({ data: { cards: [{ card_group: [{ title: "热搜1", desc: "热搜1", desc_extr: "123", pic: "img_search_1", scheme: "https://m.weibo.cn" }] }] } }),
    },
  };
  runScript(responses);
  await delay(5); // 等待 bootstrap（setTimeout 0）注入控件并绑定事件
  const sel = els["ext-channels"];
  sel.value = "微博";
  sel.trigger("change");
  // 抓取进行中应显示「加载中」
  const loading = els["ex-user-msg"].text();
  assert.ok(loading.indexOf("正在加载") >= 0, "切换后应显示加载中，实际: " + loading);
  await delay(40);
  const msg = els["ex-user-msg"].text();
  assert.ok(msg === "" || msg.indexOf("失败") < 0, "正常数据加载完成应清除提醒，实际: " + msg);
});

test("请求超时会在右侧提示（超时）", async () => {
  const responses = {
    "m.weibo.cn": { action: "timeout" },
  };
  runScript(responses);
  await delay(5); // 等待 bootstrap 注入控件
  const sel = els["ext-channels"];
  sel.value = "微博";
  sel.trigger("change");
  const loading = els["ex-user-msg"].text();
  assert.ok(loading.indexOf("正在加载") >= 0, "超时前应先显示加载中，实际: " + loading);
  await delay(40);
  const msg = els["ex-user-msg"].text();
  assert.ok(msg.indexOf("超时") >= 0, "超时应更新为超时提示，实际: " + msg);
});

test("网络错误会在右侧提示（network）", async () => {
  const responses = {
    "m.weibo.cn": { action: "error" },
  };
  runScript(responses);
  await delay(5);
  const sel = els["ext-channels"];
  sel.value = "微博";
  sel.trigger("change");
  await delay(40);
  const msg = els["ex-user-msg"].text();
  assert.ok(msg.indexOf("失败（network）") >= 0, "网络错误应提示 network，实际: " + msg);
});

test("返回数据格式异常（坏 JSON）会在右侧提示", async () => {
  const responses = {
    "m.weibo.cn": { action: "load", status: 200, body: "<<<not json>>>" },
  };
  runScript(responses);
  await delay(5);
  const sel = els["ext-channels"];
  sel.value = "微博";
  sel.trigger("change");
  await delay(40);
  const msg = els["ex-user-msg"].text();
  assert.ok(msg.indexOf("失败") >= 0 || msg.indexOf("为空") >= 0, "坏数据应提示失败或为空，实际: " + msg);
});

test("HTTP 非 2xx 会在右侧提示", async () => {
  const responses = {
    "m.weibo.cn": { action: "load", status: 403, body: "" },
  };
  runScript(responses);
  await delay(5);
  const sel = els["ext-channels"];
  sel.value = "微博";
  sel.trigger("change");
  await delay(40);
  const msg = els["ex-user-msg"].text();
  assert.ok(msg.indexOf("失败（HTTP 403）") >= 0, "403 应提示 HTTP 403，实际: " + msg);
});

test("首次加载默认频道（百度热搜）应自动发起请求", async () => {
  runScript({ "top.baidu.com": { action: "load", status: 200, body: "<html></html>" } });
  await delay(5);
  await delay(40);
  assert.ok(GM_CALLS.some((u) => u.indexOf("top.baidu.com") >= 0), "默认应请求百度热搜: " + GM_CALLS.join(","));
});

test("关键词超过 100 条时分页：第一页 100 条且显示分页控件", async () => {
  // 构造 250 条微博数据
  const group = [];
  for (let i = 1; i <= 250; i++) group.push({ title: "热搜" + i, desc: "热搜" + i, desc_extr: "123", pic: "img_search_" + i, scheme: "https://m.weibo.cn/" + i });
  const body = JSON.stringify({ data: { cards: [{ card_group: group }] } });
  runScript({ "m.weibo.cn": { action: "load", status: 200, body } });
  await delay(5); // 等待 bootstrap 注入控件
  const sel = els["ext-channels"];
  sel.value = "微博";
  sel.trigger("change");
  await delay(40);
  const list = els["ext-keywords-list"];
  const html = list.children.join("");
  const linkCount = (html.match(/col-sm-3 col-12 keyword-link/g) || []).length;
  assert.equal(linkCount, 100, "第一页应渲染 100 条，实际 " + linkCount);
  assert.ok(html.indexOf("ext-pager") >= 0, "应显示分页控件");
  assert.ok(html.indexOf("第 1 / 3 页") >= 0, "应显示 3 页，实际片段: " + (html.match(/第 [^<]+页/g) || []));
  assert.ok(html.indexOf("justify-content:center") >= 0, "分页控件应居中（justify-content:center）");
});

// 全部测试结束后清理泄漏的 timer（setInterval 轮询），让进程干净退出
test("__cleanup__", () => {
  for (const id of liveTimers) clearInterval(id);
  liveTimers.clear();
});
