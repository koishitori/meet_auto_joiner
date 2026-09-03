// background.js

async function getMeetWindowId() {
  const { meetWindowId } = await chrome.storage.local.get('meetWindowId');
  return meetWindowId;
}

async function setMeetWindowId(id) {
  await chrome.storage.local.set({ meetWindowId: id });
}

async function ensureMeetWindow(urlToOpen) {
  const meetWindowId = await getMeetWindowId();

  if (meetWindowId != null) {
    try {
      await chrome.windows.get(meetWindowId);
      await chrome.tabs.create({ url: urlToOpen, active: true, windowId: meetWindowId });
      return;
    } catch (e) {
      await chrome.storage.local.remove('meetWindowId');
    }
  }

  const win = await chrome.windows.create({ url: urlToOpen, focused: true });
  if (win.id != null) await setMeetWindowId(win.id);
}

// storage の内容からアラームを張り直す
async function refreshAlarms() {
  const res = await chrome.storage.sync.get(["meetAutoJoinEvents"]);
  const map = res.meetAutoJoinEvents || {};

  // 既存アラームを全削除
  const alarms = await chrome.alarms.getAll();
  for (const alarm of alarms) {
    if (alarm.name.startsWith("meet-auto-join-")) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  const now = Date.now();

  for (const [eventId, entry] of Object.entries(map)) {
    if (!entry.enabled) continue;

    // targetUrl がなければスキップ（meet / other 共通）
    if (!entry.startTimeISO || !entry.targetUrl) continue;

    const start = new Date(entry.startTimeISO).getTime();
    const offsetMinutes = entry.offsetMinutes ?? 1;
    const triggerTime = start - offsetMinutes * 60 * 1000;

    if (triggerTime <= now) continue;

    await chrome.alarms.create(`meet-auto-join-${eventId}`, { when: triggerTime });

    if (Array.isArray(entry.extraUrls)) {
      entry.extraUrls.forEach(async (url, i) => {
        if (!url) return;
        await chrome.alarms.create(`meet-auto-join-${eventId}-extra-${i}`, { when: triggerTime });
      });
    }
  }
}

// カレンダー側からのメッセージでアラーム再設定
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "refresh-alarms") {
    refreshAlarms();
  }
});

// アラーム発火時に URL を開く
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("meet-auto-join-")) return;

  // extra URL アラームの処理
  const extraMatch = alarm.name.match(/^meet-auto-join-(.+)-extra-(\d+)$/);
  if (extraMatch) {
    const eventId = extraMatch[1];
    const idx = parseInt(extraMatch[2], 10);
    const res = await chrome.storage.sync.get(["meetAutoJoinEvents"]);
    const entry = (res.meetAutoJoinEvents || {})[eventId];
    if (!entry || !entry.enabled || !Array.isArray(entry.extraUrls)) return;
    const url = entry.extraUrls[idx];
    if (url) await ensureMeetWindow(url);
    return;
  }

  const eventId = alarm.name.replace("meet-auto-join-", "");

  const res = await chrome.storage.sync.get(["meetAutoJoinEvents"]);
  const map = res.meetAutoJoinEvents || {};
  const entry = map[eventId];

  // enabled かつ targetUrl と startTimeISO があるものだけ処理
  if (!entry || !entry.enabled || !entry.targetUrl || !entry.startTimeISO) return;

  const currentStart = new Date(entry.startTimeISO).getTime();
  if (isNaN(currentStart)) return;

  // 1. 開くURLを決定
  let urlToOpen = entry.targetUrl;

  // Meet のときだけ autojoin パラメータを付けたい場合
  try {
    const urlObj = new URL(urlToOpen);
    if (urlObj.hostname.endsWith("meet.google.com")) {
      urlObj.searchParams.set("autojoin", "1");
      urlToOpen = urlObj.toString();
    }
  } catch (e) {
    // 不正な URL ならそのまま使う or return するなどお好みで
  }

  // 2. タブを開く（同一ウィンドウに集約）
  await ensureMeetWindow(urlToOpen);

  // 3. 「このイベントより古いもの」をストレージから削除
  const newMap = {};
  for (const [id, e] of Object.entries(map)) {
    if (!e.startTimeISO) continue;

    const start = new Date(e.startTimeISO).getTime();
    if (isNaN(start)) continue;

    // currentStart より新しい or 同じものだけ残す
    if (start >= currentStart) {
      newMap[id] = e;
    }
  }

  await chrome.storage.sync.set({ meetAutoJoinEvents: newMap });
});

// 拡張インストール / 起動時にもアラームを構成
chrome.runtime.onInstalled.addListener(() => {
  refreshAlarms();
});
chrome.runtime.onStartup.addListener(() => {
  refreshAlarms();
});
