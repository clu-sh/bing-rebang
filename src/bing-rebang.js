// ==UserScript==
// @name         必应-今日热榜
// @namespace    https://greasyfork.org/zh-CN/users/1513778-chris-lu
// @version      2026.05.07.02
// @description  必应 Bing 搜索添加今日热榜，Microsoft Rewards点击赚积分
// @author       Chris Lu
// @match        *://*.bing.com/search*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bing.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js#sha512-v2CJ7UaYy4JwqLDIrZUI/4hqeoQieOmAZNXBeQyjo21dadnwR+8ZaIJVT8EE2iyI61OV8e6M8PP2/4hpQINQ/g==
// @license      GPL-3.0-or-later; https://www.gnu.org/licenses/gp
// @antifeature referral-link This script includes a refer link.
// @grant        unsafeWindow
// @grant        GM_addStyle
// @source       https://github.com/clu-sh/bing-rebang/blob/master/src/bing-rebang.js
// @downloadURL  https://update.greasyfork.org/scripts/549091/%E5%BF%85%E5%BA%94-%E4%BB%8A%E6%97%A5%E7%83%AD%E6%A6%9C.user.js
// @updateURL    https://update.greasyfork.org/scripts/549091/%E5%BF%85%E5%BA%94-%E4%BB%8A%E6%97%A5%E7%83%AD%E6%A6%9C.meta.js
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
    API_BASE: "https://api.pearktrue.cn/api/dailyhot",
  };

  const CSS_STYLES = `
#rebang { padding: 0px 18px; margin-bottom: 30px; }
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
  let isInitialized = false;
  let hasScrolledCurrentPage = false;
  let isScrollAnimating = false;
  let scrollBackTimer = null;

  // ===================== 工具函数 =====================

  /** 获取今日自动搜索次数的存储键名 */
  function getAutoSearchCountKey() {
    return `${PREFIX}AutoSearchCount_${new Date().toISOString().split("T")[0]}`;
  }

  /** 获取当前频道的缓存键名 */
  function getCurrentChannelKeywordsCacheKey() {
    return `${PREFIX}${getCurrentChannel()}`;
  }

  /** 获取当前选中的频道 */
  function getCurrentChannel() {
    return localStorage.getItem(STORAGE_KEYS.SELECTED_CHANNEL) || "微博";
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
    $("#sb_form_q").val(keyword);
    $("#sb_form_go").click();
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

    channels.forEach((channel) => {
      const opt = new Option(channel, channel);
      opt.selected = channel === selectedChannel;
      $("#ext-channels").append(opt);
    });

    // 首次运行时设置默认值
    if (localStorage.getItem(STORAGE_KEYS.SELECTED_CHANNEL) === null) {
      localStorage.setItem(STORAGE_KEYS.SELECTED_CHANNEL, "微博");
    }

    loadKeywords();
  }

  /** 加载关键词（优先从缓存读取） */
  function loadKeywords() {
    const cacheKey = getCurrentChannelKeywordsCacheKey();
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      renderKeywords(JSON.parse(cached));
      console.log(`[必应热榜] 命中缓存: ${cacheKey}`);
      return;
    }

    const channelName = getCurrentChannel();
    $.ajax({
      url: `${UI.API_BASE}/?title=${encodeURIComponent(channelName)}`,
      method: "GET",
      timeout: 15000,
    })
      .done((response) => {
        if (response.code === 200 && Array.isArray(response.data)) {
          localStorage.setItem(cacheKey, JSON.stringify(response.data));
          renderKeywords(response.data);
          console.log(`[必应热榜] 已获取关键词: ${cacheKey}`);
        } else {
          showUserMessage(`获取热榜 [${channelName}] 关键词失败，请稍后重试`);
        }
      })
      .fail((jqXHR, textStatus) => {
        showUserMessage(`网络请求失败 (${textStatus})，请检查网络后重试`);
        console.error(`[必应热榜] 获取关键词失败:`, textStatus);
      });
  }

  /** 渲染关键词列表 */
  function renderKeywords(keywords) {
    const $list = $("#ext-keywords-list").empty();
    const linkType = $("#ext-keywords-linktype").val();
    const isSearchMode = linkType === "搜索";
    const isCustomChannel = getCurrentChannel() === "自定义";

    (keywords || []).forEach((item, index) => {
      const displayTitle = `${index + 1}. ${truncateText(item.title)}`;

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
              title="${item.title}" href="${item.url || item.mobileUrl || "#"}">${displayTitle}</a>`
          );
        }

        $item.append(
          `<button class="keyword-delete-btn" data-custom-index="${index}" title="删除">✕</button>`
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
            title="${item.title}" href="${item.url || item.mobileUrl || "#"}">${displayTitle}</a>`
        );
      }
    });

    // 添加 Rewards 推广链接
    $list.append(
      `<a target="_blank" class="col-12 keyword-link" href="${UI.REWARDS_URL}">
        👉 加入 Microsoft Rewards 点击🔥热🔥点🔥赚取积分！👈</a>`
    );

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
        renderKeywords(items);
      }
    });
  }

  // ===================== 控件初始化 =====================

  /** 初始化所有UI控件 */
  function initControls() {
    if (window.top !== window.self) {
      console.log("[必应热榜] 在 iframe 中运行，跳过初始化");
      return;
    }

    if ($("#rebang").length > 0 || $("#b_content").length === 0) {
      return;
    }

    // 注入主界面 HTML
    $("#b_content").prepend(`
      <div id="rebang">
        <div class="row">
          <label class="col-form-label"><strong>今日热榜:</strong></label>
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

    isInitialized = true;
  }

  /** 加载频道列表（优先缓存） */
  function loadChannelList() {
    const cached = localStorage.getItem(STORAGE_KEYS.CHANNEL_LIST);
    const isCustomSelected = getCurrentChannel() === "自定义";

    if (cached !== null) {
      initChannels(JSON.parse(cached), getCurrentChannel());
      console.log("[必应热榜] 命中频道缓存");
      return;
    }

    if (isCustomSelected) {
      // 自定义模式：无需加载频道列表，直接加载关键词
      loadKeywords();
      console.log("[必应热榜] 自定义模式，跳过频道加载");
      return;
    }

    $.ajax({
      url: UI.API_BASE,
      method: "GET",
      timeout: 15000,
    })
      .done((response) => {
        if (response.code === 200 && response.data?.platforms) {
          localStorage.setItem(
            STORAGE_KEYS.CHANNEL_LIST,
            JSON.stringify(response.data.platforms)
          );
          initChannels(response.data.platforms, getCurrentChannel());
          console.log("[必应热榜] 已获取频道列表");
        } else {
          showUserMessage("获取热榜频道失败，请稍后重试");
          // 接口返回异常时回退到自定义模式
          fallbackToCustomMode();
        }
      })
      .fail((jqXHR, textStatus) => {
        showUserMessage(`网络请求失败 (${textStatus})，请检查网络后重试`);
        console.error("[必应热榜] 获取频道列表失败:", textStatus);
        // 网络请求失败时回退到自定义模式
        fallbackToCustomMode();
      });
  }

  /** 回退到自定义模式 */
  function fallbackToCustomMode() {
    localStorage.setItem(STORAGE_KEYS.SELECTED_CHANNEL, "自定义");
    localStorage.setItem(STORAGE_KEYS.CURRENT_KEYWORD_INDEX, 0);
    if ($("#ext-channels").length) {
      $("#ext-channels").val("自定义");
    }
    if ($("#rebang").length) {
      $("#rebang").addClass("rebang-custom-mode");
    }
    loadKeywords();
    console.log("[必应热榜] 已回退到自定义模式");
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
    // 检查控件是否存在（Bing 页面可能动态刷新导致控件丢失）
    if ($("#rebang").length === 0) {
      //initControls();
    }

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

  // 页面加载完成后启动轮询
  $(document).ready(() => {
    if (window.top !== window.self) return;

    // 先尝试立即初始化
    initControls();

    // 启动轮询（如果尚未初始化完成）
    pollTimer = setInterval(mainLoop, AUTO_SEARCH.POLL_INTERVAL_MS);
  });
})();