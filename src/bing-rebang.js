// ==UserScript==
// @name         必应-今日热榜
// @namespace    https://greasyfork.org/zh-CN/users/1513778-chris-lu
// @version      2025.12.02.02
// @description  必应 Bing 搜索添加今日热榜，Microsoft Rewards点击赚积分
// @author       Chris Lu
// @match        *://*.bing.com/search*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bing.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js#sha512-v2CJ7UaYy4JwqLDIrZUI/4hqeoQieOmAZNXBeQyjo21dadnwR+8ZaIJVT8EE2iyI61OV8e6M8PP2/4hpQINQ/g==
// @license      GPL-3.0-or-later; https://www.gnu.org/licenses/gp
// @antifeature referral-link This script includes a refer link.
// @grant        unsafeWindow
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @downloadURL https://update.greasyfork.org/scripts/549091/%E5%BF%85%E5%BA%94-%E4%BB%8A%E6%97%A5%E7%83%AD%E6%A6%9C.user.js
// @updateURL https://update.greasyfork.org/scripts/549091/%E5%BF%85%E5%BA%94-%E4%BB%8A%E6%97%A5%E7%83%AD%E6%A6%9C.meta.js
// ==/UserScript==
GM_addStyle(`
#rebang{
padding:0px 18px;
margin-bottom:30px;
}

#ex-search-keywords{
border:solid silver 1px;
border-radius:5px;
padding:10px;
}

.col-form-label{
line-height:30px;
margin-right:10px;
}

.form-select{
margin-right:10px;
}
.row{
  display: flex;
  flex-wrap: wrap;
  margin-bottom:10px;
}

.col-sm-3{
width:25%;
}
@media only screen and (max-width: 600px) {
.col-12{
width:100%;
}.col-6{
width:50%;
}
}
.rebang-link {
font-size:14px;
overrlow:hidden;
white-space:nowrap;
margin-bottom:3px;
}`);

this.$ = this.jQuery = jQuery.noConflict(true);

function truncateText(str, maxlength) {
  if (str.length > maxlength) {
    return str.slice(0, maxlength - 1) + "…";
  }
  return str;
}

function getAutoSearchCount() {
  const today = new Date();
  let key = today.toISOString().split("T")[0]; // "2025-12-01"
  return localStorage.getItem(key) ?? 0;
}
function setAutoSearchCount(val) {
  const today = new Date();
  let key = today.toISOString().split("T")[0]; // "2025-12-01"
  localStorage.setItem(key, val);
}
function geKeywordsCacheKey() {
  var channel = getCurrentChannel();
  return `RebangChannel_${channel}`;
}

function getCurrentChannel() {
  return localStorage.getItem("SelectedRebangChannel") ?? "微博";
}

function doSearch(keyword) {
  $("#sb_form_q").val(keyword);
  $("#sb_form_go").click();
}

function fetchKeywordsBySource() {
  var cacheKey = geKeywordsCacheKey();
  var keywords = sessionStorage.getItem(cacheKey);
  if (keywords) {
    renderKeywordsBySource(
      sessionStorage.getItem(cacheKey) ? JSON.parse(keywords) : null
    );
    console.log(`hit ${cacheKey} cache`);
  } else {
    $.ajax({
      url:
        "https://api.pearktrue.cn/api/dailyhot/?title=" + getCurrentChannel(),
      method: "GET",
      timeout: 0,
    }).done(function (response) {
      if (response.code == 200 && response.data) {
        keywords = response.data;
        sessionStorage.setItem(cacheKey, JSON.stringify(keywords));
        renderKeywordsBySource(keywords);
        console.log(`fetched ${cacheKey}`);
      }
    });
  }
}

function initChannels(channels, selectedChannel) {
  channels?.forEach(function (element) {
    var opt = new Option(element, element);
    opt.selected = element == selectedChannel;
    $("#ext-search-channels").append(opt);
  });

  $("#ext-job-times").val(localStorage.getItem("limitSearchCount"));

  $("#ext-search-channels").change(function (e) {
    localStorage.setItem("SelectedRebangChannel", $(this).val());
    localStorage.setItem("currentKeywordIndex", 0);
    fetchKeywordsBySource();
  });

  $("#ext-search-link-type").change(function (e) {
    fetchKeywordsBySource();
  });

  $("#ext-job-times").change(function (e) {
    localStorage.setItem("limitSearchCount", $(this).val());
  });

  $("#ext-search-refresh").click(function (e) {
    sessionStorage.removeItem(`RebangChannel_${getCurrentChannel()}`);
    fetchKeywordsBySource();
  });

  if (localStorage.getItem("SelectedRebangChannel") == null) {
    localStorage.setItem("SelectedRebangChannel", "微博");
  }

  fetchKeywordsBySource(); //第一次加载
}

function renderKeywordsBySource(keywords) {
  $("#ex-search-keywords").empty();
  keywords.forEach(function (element, index) {
    if ($("#ext-search-link-type").val() == "搜索")
      $("#ex-search-keywords").append(
        `<a target='_self' class='col-sm-3 col-12 rebang-link rebang-link-search' title='${
          element.title
        }' href='javascript:void();'>${index + 1}. ${truncateText(
          element.title,
          16
        )}</a>`
      );
    else
      $("#ex-search-keywords").append(
        `<a target='_blank' class='col-sm-3 col-12 rebang-link' title='${
          element.title
        }' href='${element.url ?? element.mobileUrl}'>${
          index + 1
        }. ${truncateText(element.title, 16)}</a>`
      );
  });

  $("#ex-search-keywords").append(
    `<a target='_blank' class='col-12 rebang-link' href='https://rewards.bing.com/welcome?rh=3D3F7F7&ref=rafsrchae'>👉加入Microsoft Rewards点击🔥热🔥点🔥赚取积分！👈</a>`
  );
  $("#b_content").css("padding-top", "10px");

  $("#ex-search-keywords .rebang-link-search").click(function (e) {
    doSearch($(this).attr("title"));
  });
}

function renderRebang() {
  if (window.top !== window.self) {
    console.log("run in an iframe.");
  }
  if ($("#rebang").length == 0 && $("#b_content").length > 0) {
    $("#b_content").prepend(
      "<div id='rebang'><div class='row'><label class='col-form-label'><strong>今日热榜: </strong></label><select id='ext-search-channels' class='form-select' title='平台'></select><label class='col-form-label'><strong>点击操作: </strong></label><select id='ext-search-link-type' class='form-select' title='操作'><option value='搜索' selected>搜索</option><option value='打开'>打开</option></select><button id='ext-search-refresh' type='button'>刷新</button><label  class='col-form-label' style='margin-left:20px;'><strong>自动搜索:</strong> <span  class='col-form-label' id='ext-current-count'></span>/</label><input type='text' class='form-control' style='width:50px;margin-right:2px;' id='ext-job-times'></input><label  class='col-form-label'> 次</label><label id='ex-user-msg' class='col-form-label'></label></div><div class='row' id='ex-search-keywords'><div class</div></div>"
    );

    if (sessionStorage.getItem("RebangChannels") !== null) {
      initChannels(
        JSON.parse(sessionStorage.getItem("RebangChannels")),
        getCurrentChannel()
      );
      console.log("hit RebangChannels cache.");
    } else {
      $.ajax({
        url: "https://api.pearktrue.cn/api/dailyhot",
        method: "GET",
        timeout: 0,
      }).done(function (response) {
        if (response.code == 200 && response.data && response.data.platforms) {
          sessionStorage.setItem(
            "RebangChannels",
            JSON.stringify(response.data.platforms)
          );
          initChannels(response.data.platforms, getCurrentChannel());
          console.log("fetched RebangChannels.");
        }
      });
    }
  }
}

// 实现平滑滚动到页面底部的函数
function smoothScrollDownUp() {
  document.documentElement.scrollIntoView({ behavior: "smooth", block: "end" });
}

function execAutoSearch(lockKey) {
  let jobLockExpires = localStorage.getItem(lockKey) ?? "";
  if (
    jobLockExpires.length == 0 ||
    (jobLockExpires.length > 0 && new Date(jobLockExpires) < new Date())
  ) {
    // 生成随机延迟时间
    let randomDelay = Math.floor(Math.random() * 6000) + 8000; // 生成8秒到14秒之间的随机数
    var t = new Date();
    t.setSeconds(t.getSeconds() + randomDelay / 1000);
    localStorage.setItem(lockKey, t);

    // 获取当前搜索次数
    let currentSearchCount = Number(getAutoSearchCount() ?? 1);
    let limitSearchCount = Number($("#ext-job-times").val() ?? 50);
    let currentKeywordIndex = Number(
      localStorage.getItem("currentKeywordIndex") ?? 0
    );

    // 根据计数器的值选择搜索引擎
    if (currentSearchCount < limitSearchCount) {
      smoothScrollDownUp(); // 添加执行滚动页面的操作

      var cacheKey = geKeywordsCacheKey();
      var keywords = JSON.parse(sessionStorage.getItem(cacheKey));

      if (keywords.length > currentKeywordIndex + 1) {
        currentSearchCount++;
        currentKeywordIndex++;
        setAutoSearchCount(currentSearchCount);
        localStorage.setItem("currentKeywordIndex", currentKeywordIndex);
        $("#ext-current-count").text(currentSearchCount);
        doSearch(keywords[currentKeywordIndex - 1].title);
      } else {
        $("#ex-user-msg").text("当前已完成，请切换热榜。");
      }
    }
  }
}

(function () {
  "use strict";

  $(document).ready(function () {
    if (window.top === window.self) {
      renderRebang();

      this.intervalId =
        this.intervalId ||
        setInterval(function () {
          if ($("#rebang").length == 0) {
            renderRebang();
          }

          if ($("#ext-job-times").val() != "") {
            let currentSearchCount = getAutoSearchCount() ?? 1;
            if (currentSearchCount != $("#ext-job-times").val()) {
              $("#ext-current-count").text(currentSearchCount);
              execAutoSearch("Rebang_AutoJob_Expires");
            }
          }
        }, 1000);
    }
  });
})();
