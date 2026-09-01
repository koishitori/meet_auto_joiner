// 1. UI を埋め込む
function injectUi() {
  if (document.getElementById("meet-auto-join-panel")) return;

  const panel = document.createElement("div");
  panel.id = "meet-auto-join-panel";
  panel.style.position = "fixed";
  panel.style.top = "10px";
  panel.style.right = "10px";
  panel.style.zIndex = "9999";
  panel.style.background = "rgba(0,0,0,0.7)";
  panel.style.color = "#fff";
  panel.style.padding = "8px";
  panel.style.borderRadius = "4px";
  panel.style.fontSize = "12px";
  panel.style.transition = "opacity 0.5s ease-out";

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
      <span style="font-weight:bold;">自動参加</span>
      <button id="close-panel" style="background:none; border:none; color:#fff; cursor:pointer; font-size:14px;">×</button>
    </div>
    <label style="display:flex; align-items:center; gap:4px;">
      <input type="checkbox" id="auto-join-enabled">
      <span>自動参加を有効にする</span>
    </label>
    <div style="margin-top:4px;">
      <span>何分前に参加:</span>
      <select id="join-minutes" style="margin-left:4px; font-size:12px;">
        <option value="5">5分前</option>
        <option value="4">4分前</option>
        <option value="3">3分前</option>
        <option value="2">2分前</option>
        <option value="1" selected>1分前</option>
        <option value="0">開始時刻</option>
      </select>
    </div>
    <div style="margin-top:4px;">
      <span>開始時刻(HH:MM)</span><br>
      <input type="time" id="auto-join-time" style="font-size:12px;">
    </div>
    <div id="auto-join-status" style="margin-top:4px;"></div>
  `;

  document.body.appendChild(panel);

  const checkbox = document.getElementById("auto-join-enabled");
  const timeInput = document.getElementById("auto-join-time");
  const minutesSelect = document.getElementById("join-minutes");
  const status = document.getElementById("auto-join-status");
  const closeBtn = document.getElementById("close-panel");

  closeBtn.addEventListener("click", () => {
    panel.remove();
  });

  let timerId = null;

  function updateTimer() {
    if (timerId) clearTimeout(timerId);
    
    if (!checkbox.checked) {
      status.textContent = "自動参加: OFF";
      return;
    }

    const t = timeInput.value;
    if (!t) {
      status.textContent = "開始時刻を入力してください";
      return;
    }

    const now = new Date();
    const [hh, mm] = t.split(":").map(Number);
    const target = new Date();
    target.setHours(hh, mm, 0, 0);

    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    const minutes = parseInt(minutesSelect.value);
    const joinAt = new Date(target.getTime() - minutes * 60 * 1000);
    const delay = joinAt.getTime() - now.getTime();

    if (delay <= 0) {
      status.textContent = "指定時刻をすでに過ぎています";
      return;
    }

    const minutesText = minutes === 0 ? "開始時刻" : `${minutes}分前`;
    status.textContent = `自動参加予約: ${joinAt.toLocaleTimeString()} (${minutesText}) に Join ボタンをクリック`;

    timerId = setTimeout(() => {
      autoClickJoinButton(status);
    }, delay);
  }

  checkbox.addEventListener("change", updateTimer);
  timeInput.addEventListener("change", updateTimer);
  minutesSelect.addEventListener("change", updateTimer);
}

// 2. Joinボタンを探してクリック
function autoClickJoinButton(statusElem) {
  // テキストベースでボタンを探す（UI変更で壊れやすいが、ID固定よりマシ）
  const candidates = Array.from(document.querySelectorAll("button, div[role='button']"));

  const btn = candidates.find(el => {
    const text = (el.innerText || "").toLowerCase();
    return text.includes("参加") || text.includes("join") || text.includes("参加をリクエスト") || text.includes("ask to join");
  });

  if (!btn) {
    if (statusElem) statusElem.textContent = "Joinボタンが見つかりませんでした。";
    return;
  }

  btn.click();
  if (statusElem) statusElem.textContent = "自動参加: Join ボタンをクリックしました。";
  
  // 自動参加後にフェードアウトしてパネルを閉じる
  setTimeout(() => {
    const panel = document.getElementById("meet-auto-join-panel");
    if (panel) {
      panel.style.opacity = "0";
      setTimeout(() => panel.remove(), 500);
    }
  }, 2000);
}

function shouldAutoJoinFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("autojoin") === "1";
  } catch (e) {
    return false;
  }
}

function init() {
  const autoJoinFromQuery = shouldAutoJoinFromQuery();

  const observer = new MutationObserver(() => {
    const joinText = document.body.innerText || "";
    if (joinText.includes("参加") || joinText.toLowerCase().includes("join now")) {
      observer.disconnect();

      if (autoJoinFromQuery) {
        // クエリ指定があるときは UI を出さずに即 Join
        autoClickJoinButton(null);
      } else {
        // 既存の UI ベース動作
        injectUi();
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

init();