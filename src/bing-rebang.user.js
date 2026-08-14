// ==UserScript==
// @name         必应-今日热榜
// @namespace    https://greasyfork.org/zh-CN/users/1513778-chris-lu
// @version      2026.08.14.02
// @description  必应 Bing 搜索添加今日热榜（本地多平台源，替换失效的 api.pearktrue.cn），Microsoft Rewards点击赚积分
// @author       Chris Lu
// @match        *://*.bing.com/search*
// @match        *://m.weibo.cn/*
// @match        *://www.xiaohongshu.com/*
// @match        *://edith.xiaohongshu.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bing.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js#sha512-v2CJ7UaYy4JwqLDIrZUI/4hqeoQieOmAZNXBeQyjo21dadnwR+8ZaIJVT8EE2iyI61OV8e6M8PP2/4hpQINQ/g==
// @license      GPL-3.0-or-later; https://www.gnu.org/licenses/gp
// @antifeature referral-link This script includes a refer link.
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      m.weibo.cn
// @connect      api.zhihu.com
// @connect      aweme-lq.snssdk.com
// @connect      www.toutiao.com
// @connect      api.bilibili.com
// @connect      app.bilibili.com
// @connect      top.baidu.com
// @connect      tieba.baidu.com
// @connect      hacker-news.firebaseio.com
// @connect      edith.xiaohongshu.com
// @connect      iflow.quark.cn
// @connect      m.douban.com
// @connect      www.ithome.com
// @connect      ai-bot.cn
// @source       https://github.com/clu-sh/bing-rebang/blob/master/src/bing-rebang.user.js
// @downloadURL https://update.greasyfork.org/scripts/549091/%E5%BF%85%E5%BA%94-%E4%BB%8A%E6%97%A5%E7%83%AD%E6%A6%9C.user.js
// @updateURL https://update.greasyfork.org/scripts/549091/%E5%BF%85%E5%BA%94-%E4%BB%8A%E6%97%A5%E7%83%AD%E6%A6%9C.meta.js
// ==/UserScript==

(function () {
  "use strict";

  // ===================== 常量定义 =====================
  const PREFIX = "Rebang_";
  const STORAGE_KEYS = {
    SELECTED_CHANNEL: `${PREFIX}SelectedChannel`,
    LIMIT_SEARCH_COUNT: `${PREFIX}LimitSearchCount`,
    CURRENT_KEYWORD_INDEX: `${PREFIX}CurrentKeywordIndex`,
    CHANNEL_LIST: `${PREFIX}Channels`,
    AUTO_SEARCH_LOCK: `${PREFIX}AutoSearchLock`,
    AUTO_SEARCH_LOCK_EXPIRES: `${PREFIX}AutoSearchLockExpires`,
  };

  const AUTO_SEARCH = {
    MIN_DELAY_MS: 8000,
    MAX_DELAY_MS: 14000,
    SCROLL_DELAY_MS: 1000,
    POLL_INTERVAL_MS: 1000,
  };

  /** sessionStorage 键名（每个 tab 独立，关闭自动清除） */
  const SESSION_ACTIVE_KEY = `${PREFIX}SessionActive`;

  const UI = {
    TRUNCATE_MAX_LENGTH: 16,
    REWARDS_URL:
      "https://rewards.bing.com/welcome?rh=3D3F7F7&ref=rafsrchae",
  };

  const CSS_STYLES = `
  #b_content { padding-top:10px !important;}
#rebang { padding: 10px 10%;  }
#ext-keywords-list { border: solid silver 1px; border-radius: 5px; padding: 10px; }
.col-form-label { line-height: 30px; margin-right: 10px; }
.form-select { margin-right: 5px; }
.row { display: flex; flex-wrap: wrap; margin-bottom: 10px; }
.col-sm-3 { width: 25%; }
@media only screen and (max-width: 600px) {
  .col-12 { width: 100%; }
  .col-6 { width: 50%; }
}
.keyword-link {
  font-size: 14px;
  overflow: hidden;
  white-space: nowrap;
  margin-bottom: 3px;
}
.keyword-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.keyword-delete-btn {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0 2px;
  margin: 0;
  flex-shrink: 0;
}
.keyword-delete-btn:hover {
  color: #e81123;
  font-weight: bold;
}
.autosearch-active {
  color: #0078d4 !important;
}
.custom-action-btn {
  margin-left: 4px;
}
button.custom-keyword,
#ext-keywords-refresh,
#txt-custom-keyword {
  margin-left: 2px;
}

/* ===== 分页控件 ===== */
.ext-page-btn {
  background: #f3f3f3;
  border: 1px solid silver;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}
.ext-page-btn:hover:not([disabled]) {
  background: #e6e6e6;
}
.ext-page-btn[disabled] {
  color: #bbb;
  cursor: not-allowed;
}

/* ===== 自定义频道关键词控件：默认隐藏，仅在选择"自定义"时显示 ===== */
.custom-keyword {
  display: none;
}
.rebang-custom-mode .custom-keyword {
  display: inline-block;
}
`;

  let $ = jQuery;
  let pollTimer = null;
  let hasBootstrapped = false;
  let hasScrolledCurrentPage = false;
  let isScrollAnimating = false;
  let scrollBackTimer = null;

  // 关键词列表分页：每页 100 条，超出分页
  const PAGE_SIZE = 100;
  let currentPage = 0;
  let lastKeywords = [];

  // ===================== 本地热搜数据源（替换失效的 api.pearktrue.cn） =====================
  // 抓取逻辑整理自 vikiboss/60s 项目（src/modules/*），原在 Node/Deno 端运行；
  // 此处改为浏览器端 + GM_xmlhttpRequest 绕过跨域。需要 Cookie 的平台（微博）会优先
  // 读取浏览器本地缓存的 Cookie，并自动镜像到 GM 共享存储与 localStorage。

  const CHROME_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

  // 微博 Cookie 兜底值（若用户未自动采集，则使用此写死值；建议为空，引导用户去自动采集）
  const WEIBO_COOKIE_FALLBACK = "";

  // 小红书逆向签名头（无法自动采集，请自行替换；留空则该源返回空）
  const XHS_HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.7(0x18000733) NetType/WIFI Language/zh_CN",
    referer: "https://app.xhs.cn/",
    "xy-direction": "22",
    shield:
      "XYAAAAAQAAAAEAAABTAAAAUzUWEe4xG1IYD9/c+qCLOlKGmTtFa+lG434Oe+FTRagxxoaz6rUWSZ3+juJYz8RZqct+oNMyZQxLEBaBEL+H3i0RhOBVGrauzVSARchIWFYwbwkV",
    "xy-platform-info":
      "platform=iOS&version=8.7&build=8070515&deviceId=C323D3A5-6A27-4CE6-AA0E-51C9D4C26A24&bundle=com.xingin.discover",
    "xy-common-params":
      "app_id=ECFAAF02&build=8070515&channel=AppStore&deviceId=C323D3A5-6A27-4CE6-AA0E-51C9D4C26A24&device_fingerprint=20230920120211bd7b71a80778509cf4211099ea911000010d2f20f6050264&device_fingerprint1=20230920120211bd7b71a80778509cf4211099ea911000010d2f20f6050264&device_model=phone&fid=1695182528-0-0-63b29d709954a1bb8c8733eb2fb58f29&gid=7dc4f3d168c355f1a886c54a898c6ef21fe7b9a847359afc77fc24ad&identifier_flag=0&lang=zh-Hans&launch_id=716882697&platform=iOS&project_id=ECFAAF&sid=session.1695189743787849952190&t=1695190591&teenager=0&tz=Asia/Shanghai&uis=light&version=8.7",
  };

  // 仅需自动从浏览器缓存采集 Cookie 的采集域（脚本在这些域名运行时会自动保存 Cookie，不初始化 Bing 热榜 UI）
  const COLLECT_HOSTS = ["m.weibo.cn", "xiaohongshu.com"];
  // GM 共享存储 / localStorage 中保存各站 Cookie 的键名
  const WEIBO_COOKIE_KEY = `${PREFIX}weibo_cookie`;
  const XHS_COOKIE_KEY = `${PREFIX}xhs_cookie`;

  // 统一请求封装：优先 GM_xmlhttpRequest（绕过浏览器 CORS），无 GM 时降级 fetch
  function request(url, headers, onSuccess, onError) {
    headers = headers || {};
    if (typeof GM_xmlhttpRequest === "function") {
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          headers: headers,
          timeout: 8000,
          onload: function (res) {
            if (res.status >= 200 && res.status < 300) {
              onSuccess(res.responseText);
            } else if (onError) {
              onError(new Error("HTTP " + res.status));
            }
          },
          onerror: function () {
            if (onError) onError(new Error("network"));
          },
          ontimeout: function () {
            if (onError) onError(new Error("超时"));
          },
        });
        return;
      } catch (e) {
        /* 落到 fetch 降级 */
      }
    }
    if (typeof fetch === "function") {
      fetch(url, { headers: headers })
        .then(function (r) {
          return r.text();
        })
        .then(function (t) {
          onSuccess(t);
        })
        .catch(function (e) {
          if (onError) onError(e);
        });
    } else if (onError) {
      onError(new Error("no http support"));
    }
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function encodeQuery(str) {
    return encodeURIComponent(str);
  }

  /* ---------- 各平台解析函数（输出 {title, hot, link}） ---------- */
  function parseWeibo(text) {
    const json = parseJson(text);
    if (!json || !json.data) return [];
    const cards = (json.data.cards && json.data.cards[0] && json.data.cards[0].card_group) || [];
    const out = [];
    const hotRe = /(\d+)/i;
    for (let i = 0; i < cards.length; i++) {
      const e = cards[i];
      if (!/img_search_\d+/.test(e.pic || "")) continue;
      const m = hotRe.exec(String(e.desc_extr || ""));
      out.push({ title: e.desc, hot: m ? +m[1] : 0, link: "https://s.weibo.com/weibo?q=" + encodeQuery(e.desc) });
    }
    return out;
  }

  function parseZhihu(text) {
    const json = parseJson(text);
    if (!json || !json.data) return [];
    const list = json.data;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const t = e.target || {};
      out.push({
        title: t.title,
        hot: e.detail_text || "",
        link: (t.url || "").replace("api.", "www.").replace("questions", "question"),
      });
    }
    return out;
  }

  function parseDouyin(text) {
    const json = parseJson(text);
    if (!json || !json.data) return [];
    const list = json.data.word_list || [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      out.push({
        title: e.word,
        hot: e.hot_value,
        link: e.word ? "https://www.douyin.com/search/" + encodeQuery(e.word) : "",
      });
    }
    return out;
  }

  function parseToutiao(text) {
    const json = parseJson(text);
    if (!json || !json.data) return [];
    const list = json.data;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      out.push({ title: e.Title, hot: +e.HotValue, link: (e.Url || "").split("?")[0].replace(/\/$/, "") });
    }
    return out;
  }

  function parseBili(text) {
    const json = parseJson(text);
    if (!json || !json.data) return [];
    const list = (json.data.trending && json.data.trending.list) || json.data.list || [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.is_commercial === "1" || e.is_commercial === 1) continue;
      const kw = e.keyword || e.show_name;
      out.push({ title: kw, hot: "", link: "https://search.bilibili.com/all?keyword=" + encodeQuery(kw) });
    }
    return out;
  }

  function parseBaiduHot(text) {
    const m = /<!--s-data:(.*?)-->/s.exec(text);
    if (!m) return [];
    const json = parseJson(m[1].replace(/\\-/g, "-"));
    if (!json || !json.data) return [];
    const list = (json.data.cards && json.data.cards[0] && json.data.cards[0].content) || [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.isTop) continue;
      const score = Number(parseInt(e.hotScore, 10));
      out.push({
        title: e.word,
        hot: score >= 10000 ? Math.round(score / 100) / 100 + "w" : e.hotScore,
        link: e.url.indexOf("http") === 0 ? e.url : "https://www.baidu.com" + e.url,
      });
    }
    return out;
  }

  function parseBaiduTieba(text) {
    const json = parseJson(text);
    if (!json || !json.data) return [];
    const list = (json.data.bang_topic && json.data.bang_topic.topic_list) || [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      out.push({ title: e.topic_name, hot: e.discuss_num || 0, link: e.topic_url });
    }
    return out;
  }

  function parseHackerNews(text) {
    const ids = parseJson(text);
    if (!ids || !ids.length) return [];
    const out = [];
    let pending = ids.length;
    if (pending === 0) return out;
    for (let i = 0; i < ids.length; i++) {
      ((id) => {
        request(
          "https://hacker-news.firebaseio.com/v0/item/" + id + ".json",
          { "User-Agent": CHROME_UA },
          function (t) {
            const s = parseJson(t);
            if (s && s.type === "story") {
              out.push({
                title: s.title || "",
                hot: s.score || 0,
                link: s.url || "https://news.ycombinator.com/item?id=" + s.id,
              });
            }
            pending--;
          },
          function () {
            pending--;
          }
        );
      })(ids[i]);
    }
    return out; // 注意：异步聚合在 fetchLocalKeywords 内单独处理
  }

  function parseRednote(text) {
    const json = parseJson(text);
    if (!json || !json.data || !json.data.items) return [];
    const list = json.data.items;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      out.push({
        title: e.title,
        hot: e.score,
        link: "https://www.xiaohongshu.com/search_result?keyword=" + encodeQuery(e.title) + "&type=51",
      });
    }
    return out;
  }

  function parseQuark(text) {
    const json = parseJson(text);
    if (!json || !json.data) return [];
    const list = json.data.articles || [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      out.push({ title: e.title, hot: e.article_like_cnt || 0, link: "https://123.quark.cn/detail?item_id=" + e.id });
    }
    return out;
  }

  function parseDouban(text) {
    const json = parseJson(text);
    if (!json || !json.subject_collection_items) return [];
    const list = json.subject_collection_items;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      out.push({ title: e.title, hot: e.rating ? e.rating.value : "", link: e.url });
    }
    return out;
  }

  function parseIthome(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const items = doc.getElementsByTagName("item");
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const title = tagText(it, "title");
      const link = tagText(it, "link");
      if (title && link) out.push({ title: title, hot: "", link: link });
    }
    return out;
  }

  function parseAinews(text) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const dates = doc.getElementsByClassName("news-date");
    const out = [];
    for (let i = 0; i < dates.length; i++) {
      const sibs = nextSiblings(dates[i], "news-item");
      for (let j = 0; j < sibs.length; j++) {
        const content = sibs[j].getElementsByClassName("news-content")[0];
        if (!content) continue;
        const h2a = content.getElementsByTagName("h2")[0];
        if (!h2a) continue;
        const a = h2a.getElementsByTagName("a")[0];
        const title = a ? a.textContent.trim() : "";
        const link = a ? a.getAttribute("href") : "";
        if (title) {
          out.push({
            title: title,
            hot: "",
            link: link && link.indexOf("http") === 0 ? link : "https://ai-bot.cn" + link,
          });
        }
      }
    }
    return out;
  }

  function tagText(el, name) {
    const n = el.getElementsByTagName(name)[0];
    return n ? n.textContent.trim() : "";
  }

  function nextSiblings(el, cls) {
    const res = [];
    let n = el.nextSibling;
    while (n) {
      if (n.nodeType === 1 && n.className && n.className.indexOf(cls) >= 0) res.push(n);
      n = n.nextSibling;
    }
    return res;
  }

  // 本地热搜源注册表（今日热榜下拉的可选项）
  const LOCAL_SOURCES = [
    { id: "baidu", name: "百度热搜", url: "https://top.baidu.com/board?tab=realtime", headers: { "User-Agent": CHROME_UA }, parse: parseBaiduHot },
    { id: "zhihu", name: "知乎", url: "https://api.zhihu.com/topstory/hot-lists/total?limit=30", headers: { "User-Agent": CHROME_UA }, parse: parseZhihu },
    { id: "douyin", name: "抖音", url: "https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880", headers: { "User-Agent": CHROME_UA }, parse: parseDouyin },
    { id: "toutiao", name: "头条", url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", headers: { "User-Agent": CHROME_UA }, parse: parseToutiao },
    { id: "bili", name: "B站", url: "https://api.bilibili.com/x/web-interface/wbi/search/square?limit=50", headers: { "User-Agent": CHROME_UA, "X-Real-IP": "157.255.219.143", "X-Forwarded-For": "157.255.219.143" }, parse: parseBili },
    { id: "tieba", name: "百度贴吧", url: "https://tieba.baidu.com/hottopic/browse/topicList", headers: { "User-Agent": CHROME_UA }, parse: parseBaiduTieba },
    { id: "hackernews", name: "Hacker News", url: "https://hacker-news.firebaseio.com/v0/topstories.json", headers: { "User-Agent": CHROME_UA }, parse: parseHackerNews, async: true },
    { id: "quark", name: "夸克", url: "https://iflow.quark.cn/iflow/api/v1/article/aggregation?aggregation_id=16665090098771297825&count=50&bottom_pos=0", headers: { "User-Agent": CHROME_UA }, parse: parseQuark },
    { id: "douban", name: "豆瓣电影榜", url: "https://m.douban.com/rexxar/api/v2/subject_collection/movie_weekly_best/items?start=0&count=10&items_only=1&for_mobile=1", headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", Referer: "https://m.douban.com/subject_collection" }, parse: parseDouban },
    { id: "ithome", name: "IT之家", url: "https://www.ithome.com/rss/", headers: { "User-Agent": CHROME_UA }, parse: parseIthome },
    { id: "ainews", name: "AI资讯", url: "https://ai-bot.cn/daily-ai-news/", headers: { "User-Agent": CHROME_UA }, parse: parseAinews },
    // 需要登录/授权的源放在列表最后
    { id: "weibo", name: "微博", url: "https://m.weibo.cn/api/container/getIndex?containerid=106003type%3D25%26t%3D3%26disable_hot%3D1%26filter_type%3Drealtimehot", headers: { "User-Agent": CHROME_UA }, parse: parseWeibo, login: true },
    { id: "rednote", name: "小红书", url: "https://edith.xiaohongshu.com/api/sns/v1/search/hot_list", headers: XHS_HEADERS, parse: parseRednote, login: true },
  ];

  // 各平台「打开」模式下无关键词直链时的兜底搜索地址（{q} 会被替换为编码后的关键词）
  // 用于保证任何关键词都能跳转到对应平台的搜索结果页
  const PLATFORM_SEARCH_URL = {
    baidu: "https://www.baidu.com/s?wd={q}",
    zhihu: "https://www.zhihu.com/search?type=content&q={q}",
    douyin: "https://www.douyin.com/search/{q}",
    toutiao: "https://so.toutiao.com/search?keyword={q}",
    bili: "https://search.bilibili.com/all?keyword={q}",
    tieba: "https://tieba.baidu.com/f?kw={q}",
    hackernews: "https://news.ycombinator.com/item?id={q}",
    quark: "https://123.quark.cn/search?q={q}",
    douban: "https://search.douban.com/movie/subject_search?search_text={q}",
    ithome: "https://www.ithome.com/search/?keyword={q}",
    ainews: "https://ai-bot.cn/?s={q}",
    weibo: "https://s.weibo.com/weibo?q={q}",
    rednote: "https://www.xiaohongshu.com/search_result?keyword={q}&type=51",
  };

  /** 根据平台 id + 关键词构造「打开」目标地址：优先用关键词直链，否则用平台搜索兜底 */
  function buildOpenUrl(srcId, item) {
    const direct = item.url || item.link;
    if (direct) return direct;
    const tpl = PLATFORM_SEARCH_URL[srcId];
    if (tpl) return tpl.replace("{q}", encodeQuery(item.title || ""));
    return "#";
  }

  // 读取微博 Cookie：优先浏览器本地缓存(共享存储) → localStorage 镜像 → 兜底写死值
  function getWeiboCookie() {
    try {
      if (typeof GM_getValue === "function") {
        const c = GM_getValue(WEIBO_COOKIE_KEY, "");
        if (c) return c;
      }
    } catch (e) {}
    try {
      const l = localStorage.getItem(WEIBO_COOKIE_KEY);
      if (l) return l;
    } catch (e) {}
    return WEIBO_COOKIE_FALLBACK;
  }

  function isCollectHost() {
    const h = location.host || "";
    for (let i = 0; i < COLLECT_HOSTS.length; i++) {
      if (h.indexOf(COLLECT_HOSTS[i]) >= 0) return true;
    }
    return false;
  }

  // 读取已保存的小红书 Cookie（当前仅供采集/调试；小红书抓取仍依赖写死的签名头）
  function getXhsCookie() {
    try {
      if (typeof GM_getValue === "function") {
        const c = GM_getValue(XHS_COOKIE_KEY, "");
        if (c) return c;
      }
    } catch (e) {}
    try {
      const l = localStorage.getItem(XHS_COOKIE_KEY);
      if (l) return l;
    } catch (e) {}
    return "";
  }

  // 在采集域仅自动抓取并保存浏览器 Cookie 到 GM 共享存储 + localStorage 镜像，
  // 不初始化任何 Bing 热榜 UI。微博与小红书都适用。
  function collectCookies() {
    const host = location.host || "";
    let key = null;
    let label = "";
    let readyHint = "";

    if (host.indexOf("m.weibo.cn") >= 0) {
      key = WEIBO_COOKIE_KEY;
      label = "微博";
      readyHint = "已自动保存微博 Cookie，返回 Bing 刷新热榜即可";
    } else if (host.indexOf("xiaohongshu.com") >= 0) {
      key = XHS_COOKIE_KEY;
      label = "小红书";
      readyHint = "已自动保存小红书 Cookie，返回 Bing 刷新热榜即可";
    } else {
      return;
    }

    function tryCollect() {
      const cookie = document.cookie || "";
      if (cookie) {
        try {
          if (typeof GM_setValue === "function") GM_setValue(key, cookie);
        } catch (e) {}
        try {
          localStorage.setItem(key, cookie);
        } catch (e) {}
        if (typeof console !== "undefined") console.log("[必应热榜] 已自动保存" + label + " Cookie");
        const t = document.createElement("div");
        t.textContent = "✅ " + readyHint;
        t.style.cssText =
          "position:fixed;left:50%;top:20px;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;padding:10px 16px;border-radius:8px;z-index:2147483647;font:14px sans-serif;max-width:80vw;";
        if (document.body) {
          document.body.appendChild(t);
          setTimeout(function () {
            if (t.parentNode) t.parentNode.removeChild(t);
          }, 4500);
        }
      } else {
        if (typeof console !== "undefined") console.log("[必应热榜] " + label + " 无可用 Cookie");
      }
    }
    if (document.body) tryCollect();
    else window.addEventListener("DOMContentLoaded", function () { setTimeout(tryCollect, 1500); });
  }

  // 跨标签自动刷新：用户在目标站登录后切回 Bing 时，自动重新抓取
  let pendingAuthRefresh = null;

  // 判断某频道是否需要授权且当前未就绪；返回 null 表示无需授权或已就绪
  function authStateFor(channelName) {
    if (channelName === "微博") {
      // 微博热搜接口公开，未登录也能抓到数据；不再前置拦截，直接抓取，
      // 抓取失败/为空时由 loadKeywords 在右侧提示（含引导去微博自动保存 Cookie）。
      return null;
    }
    if (channelName === "小红书") {
      // 小红书用逆向签名头（非 Cookie），浏览器无法自动获取；写死的签名若失效则需手动更新
      const ok = XHS_HEADERS && XHS_HEADERS.shield && XHS_HEADERS.shield.indexOf("XY") === 0;
      if (ok) return null;
      return {
        url: "https://www.xiaohongshu.com",
        label: "小红书签名头缺失，请在脚本顶部手动更新 XHS_HEADERS（无法自动获取）",
        type: "xhs",
      };
    }
    return null;
  }

  // 在右侧提醒区渲染带链接的授权提示，点击链接后标记待刷新
  function promptAuth(auth, channelName) {
    const $msg = typeof $ !== "undefined" ? $("#ex-user-msg") : null;
    const html =
      '🔒 ' +
      auth.label +
      ' <a href="' +
      auth.url +
      '" target="_blank" id="ext-auth-link" style="color:#e81123;font-weight:bold;">打开 ↗</a>';
    if ($msg && $msg.length) {
      $msg.html(html);
    } else {
      showUserMessage(auth.label);
    }
    const link = document.getElementById("ext-auth-link");
    if (link) {
      link.addEventListener("click", function () {
        // 标记：用户切回本页且授权已就绪时，自动重新抓取
        pendingAuthRefresh = channelName;
      });
    }
  }

  // 窗口重新获得焦点时，若之前点了授权链接且现在已就绪，则自动刷新
  function maybeAutoRefreshAfterAuth() {
    if (!pendingAuthRefresh) return;
    const ch = pendingAuthRefresh;
    pendingAuthRefresh = null;
    const st = authStateFor(ch);
    if (!st) {
      // 授权已就绪（如微博 Cookie 已自动保存），清除缓存并重新抓取
      localStorage.removeItem(getCurrentChannelKeywordsCacheKey());
      loadKeywords();
    } else {
      // 仍不可用（如小红书签名无法自动取），重新提示
      promptAuth(st, ch);
    }
  }

  // 根据当前频道名，抓取本地源关键词并回调（统一字段为 {title, url, hot}）
  // onDone(keywords): 成功（可能为空数组）；onFail(errMsg): 网络/超时/解析失败
  function fetchLocalKeywords(channelName, onDone, onFail) {
    const fail = (msg) => (typeof onFail === "function" ? onFail(msg) : onDone([]));
    let src = null;
    for (let i = 0; i < LOCAL_SOURCES.length; i++) {
      if (LOCAL_SOURCES[i].name === channelName) {
        src = LOCAL_SOURCES[i];
        break;
      }
    }
    if (!src) {
      onDone([]);
      return;
    }
    const hdrs = {};
    for (const k in src.headers) {
      if (src.headers.hasOwnProperty(k)) hdrs[k] = src.headers[k];
    }
    if (src.id === "weibo") {
      const ck = getWeiboCookie();
      if (ck) hdrs["Cookie"] = ck;
    } else if (src.id === "rednote") {
      const xck = getXhsCookie();
      if (xck) hdrs["Cookie"] = xck;
    }

    const normalize = (list) =>
      (list || []).map((e) => ({ title: e.title, url: e.url || e.link, hot: e.hot }));

    if (src.async) {
      // Hacker News：先取 id 列表，再并发取每条详情，用轮询等待完成
      request(
        src.url,
        hdrs,
        function (text) {
          const ids = parseJson(text);
          if (!ids || !ids.length) {
            onDone([]);
            return;
          }
          const out = [];
          let pending = ids.length;
          if (pending === 0) {
            onDone(out);
            return;
          }
          for (let i = 0; i < ids.length; i++) {
            ((id) => {
              request(
                "https://hacker-news.firebaseio.com/v0/item/" + id + ".json",
                hdrs,
                function (t) {
                  const s = parseJson(t);
                  if (s && s.type === "story") {
                    out.push({
                      title: s.title || "",
                      url: s.url || "https://news.ycombinator.com/item?id=" + s.id,
                      hot: s.score || 0,
                    });
                  }
                  pending--;
                },
                function () {
                  pending--;
                }
              );
            })(ids[i]);
          }
          const timer = setInterval(function () {
            if (pending <= 0) {
              clearInterval(timer);
              onDone(out);
            }
          }, 120);
        },
        function (err) {
          fail((err && err.message) || "network");
        }
      );
      return;
    }

    request(
      src.url,
      hdrs,
      function (text) {
        try {
          onDone(normalize(src.parse(text)));
        } catch (e) {
          fail("解析失败：" + (e && e.message ? e.message : e));
        }
      },
      function (err) {
        fail((err && err.message) || "network");
      }
    );
  }

  // ===================== 工具函数 =====================

  /** 获取今日自动搜索次数的存储键名 */
  function getAutoSearchCountKey() {
    return `${PREFIX}AutoSearchCount_${new Date().toISOString().split("T")[0]}`;
  }

  /** 获取当前频道的缓存键名 */
  function getCurrentChannelKeywordsCacheKey() {
    return `${PREFIX}${getCurrentChannel()}`;
  }

  /** 获取当前选中的频道（默认百度热搜，无需 Cookie 即可用） */
  function getCurrentChannel() {
    return localStorage.getItem(STORAGE_KEYS.SELECTED_CHANNEL) || "百度热搜";
  }

  /** 获取自动搜索锁定状态（true=已锁定/停止, false=运行中） */
  function isAutoSearchLocked() {
    return localStorage.getItem(STORAGE_KEYS.AUTO_SEARCH_LOCK) !== "off";
  }

  /** 设置自动搜索锁定状态 */
  function setAutoSearchLocked(locked) {
    localStorage.setItem(STORAGE_KEYS.AUTO_SEARCH_LOCK, locked ? "on" : "off");
  }

  /** 当前 tab 是否有活跃的自动搜索会话 */
  function isSessionActive() {
    return sessionStorage.getItem(SESSION_ACTIVE_KEY) === "true";
  }

  /** 设置当前 tab 的自动搜索会话状态 */
  function setSessionActive(active) {
    if (active) {
      sessionStorage.setItem(SESSION_ACTIVE_KEY, "true");
    } else {
      sessionStorage.removeItem(SESSION_ACTIVE_KEY);
    }
  }

  /** 显示用户消息 */
  function showUserMessage(msg) {
    $("#ex-user-msg").text(msg || "");
  }

  /** 截断文本 */
  function truncateText(str, maxLength = UI.TRUNCATE_MAX_LENGTH) {
    if (!str) return "";
    return str.length > maxLength ? str.slice(0, maxLength - 1) + "…" : str;
  }

  /** 平滑滚动到底部再返回顶部 */
  function smoothScrollDownUp() {
    if (isScrollAnimating) return;

    isScrollAnimating = true;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });

    if (scrollBackTimer) {
      clearTimeout(scrollBackTimer);
    }

    scrollBackTimer = setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      isScrollAnimating = false;
      scrollBackTimer = null;
    }, AUTO_SEARCH.SCROLL_DELAY_MS);
  }

  /** 执行搜索 */
  function doSearch(keyword) {
    var form = document.getElementById('sb_form');
      document.getElementById('sb_form_q').value = keyword;
      form.submit();
  }

  // ===================== 核心逻辑 =====================

  /** 执行自动搜索 */
  function doAutoSearch() {
    const lockExpires = localStorage.getItem(STORAGE_KEYS.AUTO_SEARCH_LOCK_EXPIRES);

    // 检查锁是否过期
    if (lockExpires && new Date(lockExpires) > new Date()) {
      return; // 锁尚未过期，跳过
    }

    // 生成随机延迟锁（8~14秒）
    const randomDelay =
      Math.floor(Math.random() * (AUTO_SEARCH.MAX_DELAY_MS - AUTO_SEARCH.MIN_DELAY_MS + 1)) +
      AUTO_SEARCH.MIN_DELAY_MS;
    const expiresAt = new Date(Date.now() + randomDelay);
    localStorage.setItem(STORAGE_KEYS.AUTO_SEARCH_LOCK_EXPIRES, expiresAt.toISOString());

    // 获取当前搜索次数
    let currentSearchCount = Number(localStorage.getItem(getAutoSearchCountKey())) || 1;
    const limitSearchCount = Number($("#ext-autosearch-limit").val()) || 50;
    let currentKeywordIndex = Number(localStorage.getItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX)) || 0;

    if (currentSearchCount >= limitSearchCount) {
      showUserMessage("已达到当日搜索上限");
      setAutoSearchLocked(true);
      setSessionActive(false);
      $("#ext-autosearch-label").removeClass("autosearch-active");
      return;
    }

    const cacheKey = getCurrentChannelKeywordsCacheKey();
    const keywordsJson = localStorage.getItem(cacheKey);

    if (!keywordsJson) {
      showUserMessage("关键词缓存为空，请先刷新热榜");
      return;
    }

    const keywords = JSON.parse(keywordsJson);

    if (!Array.isArray(keywords) || keywords.length === 0) {
      showUserMessage("当前频道无关键词可用，请切换热榜");
      return;
    }

    // 检查是否还有未搜索的关键词
    if (currentKeywordIndex >= keywords.length) {
      showUserMessage("当前频道关键词已全部搜索完毕，请切换热榜");
      setAutoSearchLocked(true);
      setSessionActive(false);
      $("#ext-autosearch-label").removeClass("autosearch-active");
      return;
    }

    // 执行搜索
    currentSearchCount++;
    currentKeywordIndex++;
    localStorage.setItem(getAutoSearchCountKey(), currentSearchCount);
    localStorage.setItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX, currentKeywordIndex);
    $("#ext-current-count").text(currentSearchCount);

    if (currentSearchCount >= limitSearchCount) {
      setAutoSearchLocked(true);
    }

    doSearch(keywords[currentKeywordIndex - 1].title);
  }

  // ===================== 频道与关键词管理 =====================

  /** 初始化频道下拉框 */
  function initChannels(channels, selectedChannel) {
    if (!Array.isArray(channels)) return;

    channels.forEach((src) => {
      const name = src.name;
      const opt = new Option(name, name);
      opt.selected = name === selectedChannel;
      $("#ext-channels").append(opt);
    });

    // 首次运行时设置默认值
    if (localStorage.getItem(STORAGE_KEYS.SELECTED_CHANNEL) === null) {
      localStorage.setItem(STORAGE_KEYS.SELECTED_CHANNEL, "百度热搜");
    }

    loadKeywords();
  }

  /** 加载关键词（优先从缓存读取，否则从本地多平台源抓取） */
  function loadKeywords() {
    currentPage = 0;
    const cacheKey = getCurrentChannelKeywordsCacheKey();
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      renderKeywords(JSON.parse(cached));
      console.log(`[必应热榜] 命中缓存: ${cacheKey}`);
      return;
    }

    const channelName = getCurrentChannel();

    // 需要授权且未就绪的源（微博缺 Cookie / 小红书缺签名）：直接给带链接提醒，不浪费请求
    const auth = authStateFor(channelName);
    if (auth) {
      promptAuth(auth, channelName);
      return;
    }

    // 发起抓取前先在右侧提示加载中
    showUserMessage(`正在加载 [${channelName}] 热榜…`);

    fetchLocalKeywords(
      channelName,
      function (keywords) {
        if (keywords && keywords.length) {
          localStorage.setItem(cacheKey, JSON.stringify(keywords));
          renderKeywords(keywords);
          showUserMessage(""); // 加载完成，清除提醒
          console.log(`[必应热榜] 已获取本地关键词: ${cacheKey}`);
        } else {
          // 网络/解析均成功，但解析后无有效条目（接口返回结构变化或确实为空）
          const tip = `获取热榜 [${channelName}] 失败：返回数据为空或格式异常，请刷新重试`;
          showUserMessage(tip);
          console.error(`[必应热榜] 获取关键词为空: ${channelName}`);
        }
      },
      function (errMsg) {
        // 网络错误 / 超时 / HTTP 非 2xx / 解析异常：在右侧明确提示失败原因
        const tip = `获取热榜 [${channelName}] 失败（${errMsg}），请刷新重试`;
        showUserMessage(tip);
        console.error(`[必应热榜] 获取关键词失败: ${channelName} - ${errMsg}`);
      }
    );
  }

  /** 渲染关键词列表（按 currentPage 分页，每页 PAGE_SIZE 条） */
  function renderKeywords(keywords) {
    lastKeywords = keywords || [];
    const $list = $("#ext-keywords-list").empty();
    const linkType = $("#ext-keywords-linktype").val();
    const isSearchMode = linkType === "搜索";
    const isCustomChannel = getCurrentChannel() === "自定义";

    // 当前频道对应的平台 id（用于「打开」模式兜底搜索地址）
    let currentSrcId = null;
    if (!isCustomChannel) {
      const ch = getCurrentChannel();
      for (let i = 0; i < LOCAL_SOURCES.length; i++) {
        if (LOCAL_SOURCES[i].name === ch) { currentSrcId = LOCAL_SOURCES[i].id; break; }
      }
    }
    // 自定义频道用 Bing 搜索兜底
    const openUrlOf = (item) => (isCustomChannel ? "https://www.bing.com/search?q=" + encodeQuery(item.title || "") : buildOpenUrl(currentSrcId, item));

    const total = lastKeywords.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;

    const start = currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, total);
    const pageItems = lastKeywords.slice(start, end);

    pageItems.forEach((item, i) => {
      const displayTitle = `${start + i + 1}. ${truncateText(item.title)}`;

      if (isCustomChannel) {
        // 自定义频道：添加链接和删除按钮
        const $item = $('<div class="col-sm-3 col-12 keyword-item"></div>');

        if (isSearchMode) {
          $item.append(
            `<a target="_self" class="keyword-link keyword-link-search"
              title="${item.title}" href="javascript:void(0);">${displayTitle}</a>`
          );
        } else {
          $item.append(
            `<a target="_blank" class="keyword-link"
              title="${item.title}" href="${openUrlOf(item)}">${displayTitle}</a>`
          );
        }

        $item.append(
          `<button class="keyword-delete-btn" data-custom-index="${i}" title="删除">✕</button>`
        );

        $list.append($item);
      } else if (isSearchMode) {
        $list.append(
          `<a target="_self" class="col-sm-3 col-12 keyword-link keyword-link-search"
            title="${item.title}" href="javascript:void(0);">${displayTitle}</a>`
        );
      } else {
        $list.append(
          `<a target="_blank" class="col-sm-3 col-12 keyword-link"
            title="${item.title}" href="${openUrlOf(item)}">${displayTitle}</a>`
        );
      }
    });

    // 添加 Rewards 推广链接
    $list.append(
      `<a target="_blank" class="col-12 keyword-link" href="${UI.REWARDS_URL}">
        👉 加入 Microsoft Rewards 点击🔥热🔥点🔥赚取积分！👈</a>`
    );

    // 分页控件（多于 1 页时显示），使用 justify-content:center 居中，
    // 避免最后一页按钮较少时整体居左（比加 <br> 更稳）
    if (totalPages > 1) {
      const prevDisabled = currentPage <= 0 ? "disabled" : "";
      const nextDisabled = currentPage >= totalPages - 1 ? "disabled" : "";
      const pager =
        `<div class="row ext-pager" style="margin-top:16px;padding-top:10px;border-top:1px solid #eee;align-items:center;justify-content:center;">` +
        `<button class="ext-page-btn" data-page="prev" ${prevDisabled}>‹ 上一页</button>` +
        `<span class="col-form-label" style="margin:0 10px;">第 ${currentPage + 1} / ${totalPages} 页（共 ${total} 条）</span>` +
        `<button class="ext-page-btn" data-page="next" ${nextDisabled}>下一页 ›</button>` +
        `</div>`;
      $list.append(pager);
    }

    // 绑定搜索模式点击事件
    $list.find(".keyword-link-search").on("click", function () {
      doSearch($(this).attr("title"));
    });

    // 绑定自定义频道删除按钮事件
    $list.find(".keyword-delete-btn").on("click", function () {
      const index = Number($(this).data("custom-index"));
      const customKey = `${PREFIX}自定义`;
      const items = JSON.parse(localStorage.getItem(customKey) || "[]");

      if (index >= 0 && index < items.length) {
        items.splice(index, 1);
        localStorage.setItem(customKey, JSON.stringify(items));
        // 重置关键词索引，防止越界
        localStorage.setItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX, 0);
        currentPage = 0;
        renderKeywords(items);
      }
    });

    // 绑定分页按钮事件
    $list.find(".ext-page-btn").on("click", function () {
      const action = $(this).data("page");
      if (action === "prev" && currentPage > 0) currentPage--;
      else if (action === "next" && currentPage < totalPages - 1) currentPage++;
      else return;
      renderKeywords(lastKeywords);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // ===================== 控件初始化 =====================

  /** 初始化所有UI控件 */
  function initControls() {
    if (window.top !== window.self) {
      console.log("控件在 iframe 中运行，跳过初始化");
      return;
    }

    if ($("#ext-channels").length > 0) {
      // 关键子元素存在，说明控件已完整初始化
      return;
    }

    if ($("#b_content").length === 0) {
      console.log("[必应热榜] 控件容器不存在，跳过初始化");
      return;
    }

    // #rebang 存在但内容被清空时，先移除残留容器再重建
    $("#rebang").remove();

    // 注入主界面 HTML
    $("#b_content").before(`
      <div id="rebang">
        <div class="row">
          <label class="col-form-label"><strong>频道:</strong></label>
          <select id="ext-channels" class="form-select" title="平台">
            <option value="自定义">自定义</option>
          </select>

          <label class="col-form-label"><strong>点击操作:</strong></label>
          <select id="ext-keywords-linktype" class="form-select" title="操作">
            <option value="搜索" selected>搜索</option>
            <option value="打开">打开</option>
          </select>

          <button id="ext-keywords-refresh" type="button">刷新</button>

          <label class="col-form-label" style="margin-left:20px;">
            <strong id="ext-autosearch-label">自动搜索:</strong>
            <span class="col-form-label" id="ext-current-count">0</span>/
          </label>
          <input type="text" class="form-control" style="width:30px;margin-right:2px;" id="ext-autosearch-limit" />
          <label class="col-form-label">次</label>
          <button id="ext-autosearch-lock" type="button">开始</button>

          <input type="text" class="custom-keyword" id="txt-custom-keyword" />
          <button class="custom-keyword" id="ext-add-custom-keyword" type="button">添加</button>
          <button class="custom-keyword" id="ext-export-keywords" type="button">导出</button>
          <button class="custom-keyword" id="ext-import-keywords" type="button">导入</button>
          <input type="file" id="ext-import-file" accept=".txt" style="display:none" />
          <label id="ex-user-msg" class="col-form-label" style="margin-left:10px;color:red;"></label>
        </div>
        <div class="row" id="ext-keywords-list"></div>
      </div>
    `);

    // 加载频道列表
    loadChannelList();

    // 根据当前频道设置自定义模式样式
    $("#rebang").toggleClass("rebang-custom-mode", getCurrentChannel() === "自定义");

    // 恢复自动搜索状态
    restoreAutoSearchState();

    // ========== 事件绑定 ==========

    $("#ext-channels").on("change", function () {
      localStorage.setItem(STORAGE_KEYS.SELECTED_CHANNEL, $(this).val());
      localStorage.setItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX, 0);
      $("#rebang").toggleClass("rebang-custom-mode", $(this).val() === "自定义");
      loadKeywords();
    });

    $("#ext-keywords-linktype").on("change", () => loadKeywords());

    $("#ext-autosearch-limit").on("change", function () {
      localStorage.setItem(STORAGE_KEYS.LIMIT_SEARCH_COUNT, $(this).val());
    });

    $("#ext-keywords-refresh").on("click", function () {
      localStorage.removeItem(getCurrentChannelKeywordsCacheKey());
      loadKeywords();
    });

    // 回车触发添加
    $("#txt-custom-keyword").on("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        $("#ext-add-custom-keyword").trigger("click");
      }
    });

    $("#ext-add-custom-keyword").on("click", function () {
      const keyword = $("#txt-custom-keyword").val().trim();
      if (!keyword) {
        showUserMessage("请输入关键词");
        return;
      }

      const customKey = `${PREFIX}自定义`;
      const existing = JSON.parse(localStorage.getItem(customKey) || "[]");
      existing.push({ title: keyword });
      localStorage.setItem(customKey, JSON.stringify(existing));
      localStorage.setItem(STORAGE_KEYS.SELECTED_CHANNEL, "自定义");
      localStorage.setItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX, 0);
      $("#ext-channels").val("自定义");
      $("#rebang").addClass("rebang-custom-mode");
      $("#txt-custom-keyword").val("");
      loadKeywords();
    });

    // 导出关键词
    $("#ext-export-keywords").on("click", function () {
      const customKey = `${PREFIX}自定义`;
      const items = JSON.parse(localStorage.getItem(customKey) || "[]");

      if (items.length === 0) {
        showUserMessage("暂无自定义关键词可导出");
        return;
      }

      const lines = items.map((item) => item.title).join("\n");
      const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BingRebang_自定义关键词_${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showUserMessage(`已导出 ${items.length} 个关键词`);
    });

    // 导入关键词
    $("#ext-import-keywords").on("click", function () {
      $("#ext-import-file").val("").trigger("click");
    });

    $("#ext-import-file").on("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (ev) {
        const text = ev.target.result;
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length === 0) {
          showUserMessage("文件中没有有效关键词");
          return;
        }

        const customKey = `${PREFIX}自定义`;
        const existing = JSON.parse(localStorage.getItem(customKey) || "[]");
        const titles = new Set(existing.map((item) => item.title));
        let addedCount = 0;

        lines.forEach((title) => {
          if (!titles.has(title)) {
            existing.push({ title });
            titles.add(title);
            addedCount++;
          }
        });

        localStorage.setItem(customKey, JSON.stringify(existing));
        localStorage.setItem(STORAGE_KEYS.SELECTED_CHANNEL, "自定义");
        localStorage.setItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX, 0);
        $("#ext-channels").val("自定义");
        $("#rebang").addClass("rebang-custom-mode");
        loadKeywords();
        showUserMessage(`成功导入 ${addedCount} 个关键词${addedCount < lines.length ? `，${lines.length - addedCount} 个已存在跳过` : ""}`);
      };
      reader.readAsText(file, "utf-8");
    });

    $("#ext-autosearch-lock").on("click", function () {
      const isLocked = isAutoSearchLocked();

      if (isLocked) {
        // 当前已锁定 → 尝试启动
        const limit = localStorage.getItem(STORAGE_KEYS.LIMIT_SEARCH_COUNT);
        if (!limit) {
          showUserMessage("请先设置自动搜索次数限制！");
          return;
        }

        const limitCount = Number(limit);
        const currentCount = Number(localStorage.getItem(getAutoSearchCountKey())) || 0;

        if (currentCount >= limitCount) {
          showUserMessage("当前搜索已达上限，请调整自动搜索次数限制后再启动！");
          return;
        }

        // 启动自动搜索
        setAutoSearchLocked(false);
        setSessionActive(true);
        hasScrolledCurrentPage = false;
        $("#ext-autosearch-label").addClass("autosearch-active"); // 标记当前 tab 为活跃会话
        localStorage.setItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX, 0);
        $(this).text("停止");
        showUserMessage("自动搜索已启动...");
      } else {
        // 当前运行中 → 停止
        setAutoSearchLocked(true);
        setSessionActive(false);
        $("#ext-autosearch-label").removeClass("autosearch-active"); // 清除当前 tab 的会话标记
        $(this).text("开始");
        showUserMessage("");
      }
    });
  }

  /** 加载频道列表（使用本地维护的多平台源，替换失效的 api.pearktrue.cn） */
  function loadChannelList() {
    initChannels(LOCAL_SOURCES, getCurrentChannel());
    console.log("[必应热榜] 使用本地热搜源（" + LOCAL_SOURCES.length + " 个平台）");
  }


  /** 恢复自动搜索控件的状态 */
  function restoreAutoSearchState() {
    const currentCount = localStorage.getItem(getAutoSearchCountKey()) || 0;
    $("#ext-current-count").text(currentCount);

    const savedLimit = localStorage.getItem(STORAGE_KEYS.LIMIT_SEARCH_COUNT);
    if (savedLimit) {
      $("#ext-autosearch-limit").val(savedLimit);
    }

    // 只在当前 tab 有活跃会话时才显示"停止"，否则显示"开始"
    const isRunning = !isAutoSearchLocked() && isSessionActive();
    $("#ext-autosearch-lock").text(isRunning ? "停止" : "开始");
    $("#ext-autosearch-label").toggleClass("autosearch-active", isRunning);
  }

  // ===================== 主循环 =====================

  /** 主轮询（定期检查并执行自动搜索） */
  function mainLoop() {
    // 每次心跳都检查控件是否完整，防止被其他脚本或页面重建清空
    initControls();

    // 只在控件已显示、锁已解除、且当前 tab 有活跃会话时执行滚动和搜索
    if ($("#rebang").length > 0 && !isAutoSearchLocked() && isSessionActive()) {
      if (!hasScrolledCurrentPage) {
        hasScrolledCurrentPage = true;
        smoothScrollDownUp();
      }
      doAutoSearch();
    }
  }

  // ===================== 启动 =====================

  // 注入全局样式
  GM_addStyle(CSS_STYLES);

  /** 启动并维持脚本运行（幂等） */
  function bootstrapRuntime() {
    // 采集域（如 m.weibo.cn / www.xiaohongshu.com）：仅自动采集浏览器 Cookie，不初始化 Bing 热榜 UI
    if (isCollectHost()) {
      collectCookies();
      return;
    }

    if (window.top !== window.self) return;

    if (!hasBootstrapped) {
      hasBootstrapped = true;

      // 启动轮询（仅启动一次）
      if (!pollTimer) {
        pollTimer = setInterval(mainLoop, AUTO_SEARCH.POLL_INTERVAL_MS);
      }
    }

    initControls();
  }

  /** 监听同页路由变化，确保控件可恢复 */
  function installNavigationHooks() {
    const rawPushState = history.pushState;
    const rawReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = rawPushState.apply(this, args);
      setTimeout(bootstrapRuntime, 0);
      return result;
    };

    history.replaceState = function (...args) {
      const result = rawReplaceState.apply(this, args);
      setTimeout(bootstrapRuntime, 0);
      return result;
    };
  }

  installNavigationHooks();

  // 用户从授权站（如微博）切回本页时，若授权已就绪则自动重新抓取热榜
  window.addEventListener("focus", maybeAutoRefreshAfterAuth);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) maybeAutoRefreshAfterAuth();
  });

  // pageshow: bfcache 返回或页面恢复场景
  window.addEventListener("pageshow", bootstrapRuntime);

  // popstate: 浏览器前进后退导致同页状态切换
  window.addEventListener("popstate", () => {
    setTimeout(bootstrapRuntime, 0);
  });

  // 首次启动：支持 ready 前后两种注入时机
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapRuntime, { once: true });
  } else {
    bootstrapRuntime();
  }
})();