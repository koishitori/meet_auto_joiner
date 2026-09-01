// calendar_content.js

// カレンダー画面のイベント詳細パネルを監視して UI を差し込む
function observeEventDetails() {
  const observer = new MutationObserver(() => {
    // 拡張コンテキストが無効なら何もしない
    if (!chrome.runtime?.id) return;

    // イベント詳細パネルっぽい要素を探す（要セレクタ調整）
    const panel = document.querySelector('[role="dialog"] div[data-eventid]');
    if (!panel) return;

    if (panel.querySelector("#meet-auto-join-calendar-panel")) return;

    injectCalendarUi(panel);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function injectCalendarUi(panel) {
  // ここでも念のためチェック
  if (!chrome.runtime?.id) return;

  const container = document.createElement("div");
  container.id = "meet-auto-join-calendar-panel";
  container.style.marginTop = "8px";
  container.style.padding = "8px";
  container.style.borderTop = "1px solid #ddd";
  container.style.fontSize = "12px";

  container.innerHTML = `
    <div style="font-weight:bold; margin-bottom:4px;">URL 自動オープン設定</div>
    <label style="display:flex; align-items:center; gap:4px; margin-bottom:4px;">
      <input type="checkbox" id="meet-auto-join-flag">
      <span>このイベントで自動オープンを有効にする</span>
    </label>

    <div style="margin-bottom:4px;">
      <span>何分前に URL を開く:</span>
      <select id="meet-auto-join-offset" style="margin-left:4px; font-size:12px;">
        <option value="0">開始時刻</option>
        <option value="1">1分前</option>
        <option value="2">2分前</option>
        <option value="3">3分前</option>
        <option value="4">4分前</option>
        <option value="5">5分前</option>
        <option value="10">10分前</option>
        <option value="15">15分前</option>
      </select>
    </div>

    <div style="margin-bottom:4px;">
      <span>開く URL 種別:</span>
      <label style="margin-left:8px;">
        <input type="radio" name="meet-auto-join-url-type" value="meet" checked>
        Meet
      </label>
      <label style="margin-left:8px;">
        <input type="radio" name="meet-auto-join-url-type" value="other">
        その他
      </label>
    </div>

    <div id="meet-auto-join-custom-url-row" style="margin-bottom:4px; display:none;">
      <span>開くURL:</span>
      <input
        type="text"
        id="meet-auto-join-custom-url"
        placeholder="https://..."
        style="margin-left:4px; font-size:12px; width:100%; box-sizing:border-box;"
      >
    </div>

    <div id="meet-auto-join-calendar-status"></div>
  `;

  panel.appendChild(container);

  const flagCheckbox = container.querySelector("#meet-auto-join-flag");
  const offsetSelect = container.querySelector("#meet-auto-join-offset");
  const statusElem = container.querySelector("#meet-auto-join-calendar-status");
  const urlTypeRadios = container.querySelectorAll(
    'input[name="meet-auto-join-url-type"]'
  );
  const customUrlRow = container.querySelector("#meet-auto-join-custom-url-row");
  const customUrlInput = container.querySelector("#meet-auto-join-custom-url");

  // イベントID と Meet URL を取得（要セレクタ確認）
  const eventId = extractEventIdFromPanel(panel);
  const meetUrl = extractMeetUrlFromPanel(panel);

  if (!eventId) {
    statusElem.textContent = "イベントID を取得できませんでした。";
    flagCheckbox.disabled = true;
    offsetSelect.disabled = true;
    urlTypeRadios.forEach(r => (r.disabled = true));
    customUrlInput.disabled = true;
    return;
  }

  function updateCustomUrlVisibility() {
    const selected = Array.from(urlTypeRadios).find(r => r.checked)?.value;
    customUrlRow.style.display = selected === "other" ? "block" : "none";
  }

  urlTypeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      updateCustomUrlVisibility();
      saveSettings();
    });
  });

  // 既存設定のロード
  try {
    chrome.storage.sync.get(["meetAutoJoinEvents"], (res) => {
      if (chrome.runtime.lastError || !chrome.runtime?.id) {
        return;
      }

      const map = res.meetAutoJoinEvents || {};
      const entry = map[eventId];
      if (entry) {
        flagCheckbox.checked = entry.enabled;
        offsetSelect.value = String(entry.offsetMinutes ?? 1);

        const urlType = entry.urlType || "meet";
        urlTypeRadios.forEach(r => {
          r.checked = (r.value === urlType);
        });

        if (entry.customUrl) {
          customUrlInput.value = entry.customUrl;
        }
      }
      updateCustomUrlVisibility();
    });
  } catch (e) {
    return;
  }

  function saveSettings() {
    if (!chrome.runtime?.id) return;

    const enabled = flagCheckbox.checked;
    const offsetMinutes = parseInt(offsetSelect.value, 10);
    const selectedUrlType =
      Array.from(urlTypeRadios).find(r => r.checked)?.value || "meet";

    // イベント開始日時を DOM から取る（ここも要セレクタ調整）
    const startDate = extractEventStartDate(panel);
    if (!startDate) {
      statusElem.textContent = "開始時刻を取得できません。";
      return;
    }

    // URLの決定
    let finalUrl = null;
    let customUrl = null;

    if (selectedUrlType === "meet") {
      if (!meetUrl) {
        statusElem.textContent = "Meet URL を取得できません。";
        return;
      }
      finalUrl = meetUrl;
    } else {
      customUrl = customUrlInput.value.trim();
      if (!customUrl) {
        statusElem.textContent = "その他URLを入力してください。";
        return;
      }
      finalUrl = customUrl;
    }

    try {
      chrome.storage.sync.get(["meetAutoJoinEvents"], (res) => {
        if (chrome.runtime.lastError || !chrome.runtime?.id) {
          return;
        }

        const map = res.meetAutoJoinEvents || {};

        map[eventId] = {
          enabled,
          offsetMinutes,
          urlType: selectedUrlType,
          meetUrl,
          customUrl,
          targetUrl: finalUrl,
          startTimeISO: startDate.toISOString()
        };
        chrome.storage.sync.set({ meetAutoJoinEvents: map }, () => {
          if (chrome.runtime.lastError || !chrome.runtime?.id) {
            return;
          }
          statusElem.textContent = "自動オープン設定を保存しました。"+map[eventId].offsetMinutes+"分前 opentype:"+map[eventId].urlType+" "+(map[eventId].urlType=="other"? map[eventId].customUrl : map[eventId].meetUrl);
          // background にアラーム再設定を依頼
          chrome.runtime.sendMessage({ type: "refresh-alarms" });
        });
      });
    } catch (e) {
      return;
    }
  }

  flagCheckbox.addEventListener("change", saveSettings);
  offsetSelect.addEventListener("change", saveSettings);
  customUrlInput.addEventListener("change", saveSettings);
}

// 以下の 3 つは元のまま

function extractEventIdFromPanel(panel) {
  const el = panel.closest("[data-eventid]");
  if (el) return el.getAttribute("data-eventid");

  const m = location.href.match(/eid=([^&]+)/);
  return m ? m[1] : null;
}

function extractMeetUrlFromPanel(panel) {
  const links = panel.querySelectorAll("a[href^='https://meet.google.com/']");
  if (links.length > 0) return links[0].href;
  return null;
}

function extractEventStartDate(panel) {
  const match = panel.innerText.match(/\s?(\d{1,2})月\s?(\d{1,2})日.*?(\d{1,2}):(\d{2})～/);
  const now = new Date();
  const year = now.getFullYear();

  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const hour = parseInt(match[3], 10);
  const minute = parseInt(match[4], 10);

  const date = new Date(year, month - 1, day, hour, minute);
  if (isNaN(date.getTime())) return null;
  return date;
}

// ---- debounce 付きイベントタイル装飾 ----

let decorating = false;
let decorateTimerId = null;

function scheduleDecorateEventTiles() {
  if (decorating && decorateTimerId !== null) return;
  decorating = true;
  decorateTimerId = setTimeout(() => {
    decorateTimerId = null;
    decorateEventTiles();
    decorating = false;
  }, 200);
}

function observeEventTiles() {
  const observer = new MutationObserver(() => {
    if (!chrome.runtime?.id) return;
    scheduleDecorateEventTiles();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function decorateEventTiles() {
  if (!document || !document.body) return;
  if (!chrome.runtime?.id) return;

  try {
    chrome.storage.sync.get(["meetAutoJoinEvents"], (res) => {
      if (chrome.runtime.lastError || !chrome.runtime?.id) {
        return;
      }

      const map = res.meetAutoJoinEvents || {};
      const eventIds = Object.keys(map);
      if (eventIds.length === 0) return;

      const tiles = document.querySelectorAll("[data-eventid]");

      tiles.forEach(tile => {
        const eventId = tile.getAttribute("data-eventid");
        const entry = map[eventId];
        if (!entry || !entry.enabled) return;

        if (tile.querySelector(".meet-auto-join-bell")) return;

        const bell = document.createElement("span");
        bell.className = "meet-auto-join-bell";
        bell.textContent = "🔔";
        bell.style.position = "absolute";
        bell.style.top = "2px";
        bell.style.left = "2px";
        bell.style.fontSize = "12px";
        bell.style.cursor = "default";
        bell.style.zIndex = "10";

        const offsetLabel =
          entry.offsetMinutes === 0 ? "開始時刻" : `${entry.offsetMinutes}分前`;
        const urlLabel =
          entry.urlType === "meet"
            ? (entry.meetUrl || "(Meet URL)")
            : (entry.customUrl || "(カスタムURL)");

        bell.title = `自動オープン: ${offsetLabel}\nURL: ${urlLabel}`;

        const computedStyle = window.getComputedStyle(tile);
        if (computedStyle.position === "static") {
          tile.style.position = "relative";
        }

        tile.appendChild(bell);
      });
    });
  } catch (e) {
    return;
  }
}

// エントリポイント
observeEventDetails();
observeEventTiles();
