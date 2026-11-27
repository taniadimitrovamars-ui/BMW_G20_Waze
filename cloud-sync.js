"use strict";

/* ==========================================
   M-GARAGE PRO
   CLOUD SYNC MODULE
   Version: 2.4.5 (Auto Auth Prompt + Clean Auto Sync + Restore)
   DATA SAFETY & ACCOUNT PROTECTION
   SUPABASE ENTITY TYPE FIX
   BACKWARD COMPATIBLE
========================================== */

import { createClient } from
  "https://esm.sh/@supabase/supabase-js@2";

/* ==========================================
   SUPABASE CONFIGURATION
========================================== */

const SUPABASE_URL =
  "https://xmyxrxunhasoxosqlkws.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_XJA2QPDo1GOZ34a_ZA3Xtg_a9vk_7Sn";

/* ==========================================
   NETWORK DIAGNOSTICS FETCH
========================================== */

const diagnosticFetch = async (input, init) => {
  const requestUrl =
    typeof input === "string"
      ? input
      : input?.url || input?.href || "";

  try {
    return await fetch(input, init);
  } catch (error) {
    let path = "неизвестен адрес";

    try {
      path = new URL(requestUrl).pathname;
    } catch {}

    const diagnosticError = new Error(
      `NETWORK_FETCH_FAILED [${path}]: ${error?.message || error}`
    );

    diagnosticError.name = error?.name || "TypeError";
    diagnosticError.cause = error;

    throw diagnosticError;
  }
};

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    global: {
      fetch: diagnosticFetch
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

/* ==========================================
   STORAGE
========================================== */

const STORAGE_KEY = "mgu_cars";
const ACTIVE_KEY = "mgu_active";
const THEME_KEY = "mgu_theme";
const PENDING_KEY = "mgu_cloud_pending";
const DEVICE_KEY = "mgu_cloud_device";
const LAST_SYNC_KEY = "mgu_cloud_last_sync";
const RESTORE_KEY = "mgu_cloud_restore_id";

const STEP_IDS = [
  "prep0", "prep", "status0", "flash", "keys", "persist",
  "ssh_fix", "store_key", "store", "waze", "recode", "after"
];

const ALLOWED_ENTITY_TYPES = new Set([
  "car",
  "step",
  "active",
  "restore"
]);

const DEVICE_ID = getDeviceId();

let suppressLocalEvents = false;
let syncRunning = false;
let syncTimer = null;
let currentUser = null;
let lastSyncError = false;
let authInitialized = false;
let initialSyncTriggered = false;

/* ==========================================
   DIAGNOSTICS HELPER
========================================== */

async function diagnoseCloudError(error, contextLabel = "операция") {
  const raw = String(error?.message || error || "Неизвестна грешка");
  const isNetworkFail = /load failed|failed to fetch|networkerror|fetch/i.test(raw);

  if (!isNetworkFail) {
    return `${contextLabel}: ${raw}`;
  }

  if (!navigator.onLine) {
    return `${contextLabel}: Устройството е офлайн (няма интернет връзка).`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.ok) {
      return `${contextLabel}: Сървърът отговаря (HTTP ${res.status}), но заявката беше прекъсната (${raw}). Провери дали Safari/AdBlocker или нестабилна връзка не блокира заявката.`;
    }
    return `${contextLabel}: Supabase сървърът върна HTTP ${res.status} (${raw}). Провери статуса на проекта в Supabase Dashboard.`;
  } catch (probeErr) {
    const probeMsg = String(probeErr?.message || probeErr);
    return `${contextLabel}: Няма връзка със сървъра (${SUPABASE_URL}) — ${raw} [${probeMsg}]. Най-чести причини: паузиран проект в Supabase, блокиране от DNS/AdBlocker/VPN или прекъсната мобилна връзка.`;
  }
}

/* ==========================================
   DEVICE
========================================== */

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);

    if (!id) {
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : "mgu-" + Date.now() + "-" +
          Math.random().toString(36).slice(2);

      localStorage.setItem(DEVICE_KEY, id);
    }

    return id;
  } catch {
    return "mgu-" + Date.now();
  }
}

function getDeviceName() {
  const ua = navigator.userAgent || "";

  if (/iPad/i.test(ua)) return "iPad";

  if (
    /iPhone/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  ) return "iPhone";

  if (/Android/i.test(ua)) return "Android";

  return "Компютър";
}

/* ==========================================
   SAFE DATA HELPERS
========================================== */

function safeString(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function safeNumber(value, min = 0, max = 999999999) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;

  return Math.min(max, Math.max(min, number));
}

function safeArray(value, max = 500) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function safeDate(value) {
  const date = safeString(value, 40);

  if (!date) return "";

  const parsed = new Date(date);

  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toISOString();
}

function safeId(value) {
  return safeString(value, 100) ||
    (crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()));
}

function safePhoto(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw) && raw.length <= 1600000) {
    return raw;
  }
  return "";
}

/* ==========================================
   SAFE DOCUMENT URL
========================================== */

function safeHttpUrl(value) {
  const raw = safeString(value, 2000);

  if (!raw) return "";

  try {
    const url = new URL(raw);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

/* ==========================================
   VEHICLE DATA MODEL
========================================== */

function cleanRecord(item, type) {
  const source = safeObject(item);

  const result = {
    id: safeId(source.id),
    date: safeDate(source.date),
    title: safeString(source.title, 150),
    description: safeString(source.description, 2000),
    mileage: safeNumber(source.mileage),
    cost: safeNumber(source.cost),
    currency: safeString(source.currency || "EUR", 5),
    provider: safeString(source.provider, 150),
    notes: safeString(source.notes, 2000)
  };

  if (
    type === "expense" ||
    type === "reminder" ||
    type === "modification"
  ) {
    result.category = safeString(source.category, 100);
  }

  if (type === "reminder") {
    result.dueDate = safeDate(source.dueDate);
    result.dueMileage = safeNumber(source.dueMileage);
    result.completed = source.completed === true;
    result.sourceServiceId = safeString(source.sourceServiceId, 100);
  }

  if (type === "service") {
    result.linkedReminderId = safeString(source.linkedReminderId, 100);
  }

  if (type === "modification") {
    result.partNumber = safeString(source.partNumber, 100);
    result.status = safeString(source.status || "Монтирано", 40) || "Монтирано";
  }

  if (type === "document") {
    result.fileName = safeString(source.fileName, 200);
    result.fileUrl = safeHttpUrl(source.fileUrl);
    result.documentType = safeString(source.documentType, 100);
  }

  return result;
}

function cleanCar(item) {
  if (!item || typeof item !== "object") return null;

  const details = safeObject(item.details);

  const vehicleType =
    details.vehicleType === "atv" ? "atv" : "car";

  const vin = safeString(item.vin, 17)
    .toUpperCase();

  if (!/^[A-Z0-9-]{5,17}$/.test(vin)) {
    return null;
  }

  const sourceDone = safeObject(item.done);
  const done = {};

  STEP_IDS.forEach(id => {
    if (sourceDone[id] === true) {
      done[id] = true;
    }
  });

  return {
    vin,
    nick: safeString(
      item.nick || (vehicleType === "atv" ? "ATV" : "BMW"),
      30
    ) || (vehicleType === "atv" ? "ATV" : "BMW"),

    done,

    details: {
      vehicleType,
      make: safeString(details.make, 60),
      model: safeString(details.model, 80),
      year: safeNumber(details.year, 0, 2100),
      engine: safeString(details.engine, 100),
      transmission: safeString(details.transmission, 100),
      mileage: safeNumber(details.mileage),
      fuel: safeString(details.fuel, 40),
      color: safeString(details.color, 60),
      registration: safeString(details.registration, 40),
      photo: safePhoto(details.photo),
      notes: safeString(details.notes, 4000)
    },

    serviceRecords: safeArray(item.serviceRecords)
      .map(record => cleanRecord(record, "service")),

    modifications: safeArray(item.modifications)
      .map(record => cleanRecord(record, "modification")),

    expenses: safeArray(item.expenses, 1000)
      .map(record => cleanRecord(record, "expense")),

    reminders: safeArray(item.reminders)
      .map(record => cleanRecord(record, "reminder")),

    documents: safeArray(item.documents)
      .map(record => cleanRecord(record, "document"))
  };
}

function cleanCars(input) {
  if (!Array.isArray(input)) return [];

  const result = [];
  const seen = new Set();

  input.forEach(item => {
    const car = cleanCar(item);

    if (!car || seen.has(car.vin)) return;

    seen.add(car.vin);
    result.push(car);
  });

  return result;
}

function stableJSON(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableJSON).join(",") + "]";
  }

  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + stableJSON(value[key])
    ).join(",") + "}";
  }

  return JSON.stringify(value);
}

/* ==========================================
   INTERFACE
========================================== */

function createInterface() {
  if (document.getElementById("cloudSyncPanel")) return;

  const panel = document.createElement("details");

  panel.id = "cloudSyncPanel";
  panel.className = "drop-panel";

  panel.innerHTML = `
    <summary>
     <div>
      <div>CLOUD SYNC · M-GARAGE PRO 2.4</div>
      <div class="drop-sub">Акаунт, синхронизация, облачен архив, устройства и история</div>
     </div>
     <span class="chev">▾</span>
    </summary>

    <div class="backup-info">
      Централизирана синхронизация на автомобилите,
      сервизните записи, модификациите, разходите и напомнянията.
    </div>

    <div class="cloud-grid">
      <div class="cloud-card">
        <div class="cloud-label">ИНТЕРНЕТ</div>
        <div id="dashboardNetwork" class="cloud-value">Проверка...</div>
      </div>
      <div class="cloud-card">
        <div class="cloud-label">CLOUD СТАТУС</div>
        <div id="dashboardCloud" class="cloud-value">Проверка...</div>
      </div>
      <div class="cloud-card">
        <div class="cloud-label">ПОСЛЕДНА СИНХРОНИЗАЦИЯ</div>
        <div id="dashboardLastSync" class="cloud-value small">Няма данни</div>
      </div>
      <div class="cloud-card">
        <div class="cloud-label">ЧАКАЩИ ПРОМЕНИ</div>
        <div id="dashboardPending" class="cloud-value">0</div>
      </div>
    </div>

    <details class="ref-box" open>
      <summary>
        Локална диагностика на чакащите промени
        <span class="chev">▾</span>
      </summary>
      <div class="backup-info">
        Информацията се чете само от това устройство.
        Не се изпращат и не се променят данни.
      </div>
      <pre id="pendingDiagnostics"
        style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7;margin:8px 0">Зареждане...</pre>
    </details>

    <div id="cloudUser" class="form-msg">Проверка на профила...</div>

    <details class="ref-box">
     <summary>Бележка за поверителност при синхронизация <span><span class="chev">▾</span></span></summary>
     <div class="alert warn" style="margin:0">
      Внимание: след вход профилът на автомобила (вкл. VIN, ако го въведеш в
      РЕГИСТРАЦИЯ или БЕЛЕЖКИ) се синхронизира в облака. Не споделяй този
      акаунт и не публикувай снимки от приложението с VIN номера.
     </div>
    </details>

    <div id="cloudAuthForm" style="margin-top:12px">
      <div class="form-grid">
        <div class="field">
          <input id="cloudEmail" type="email"
            placeholder="Имейл адрес" autocomplete="email">
        </div>
        <div class="field">
          <input id="cloudPassword" type="password"
            placeholder="Парола – минимум 6 символа"
            autocomplete="current-password">
        </div>
      </div>
      <div class="btn-row">
        <button class="btn" id="cloudLogin" type="button">Вход</button>
        <button class="btn secondary" id="cloudRegister" type="button">Регистрация</button>
      </div>
    </div>

    <div id="cloudActions" hidden style="margin-top:12px">
      <div class="btn-row">
        <button class="btn" id="cloudSync" type="button">
          ↻ Синхронизирай сега
        </button>
        <button class="btn secondary" id="cloudLogout" type="button">Изход</button>
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="cloudRetry" type="button">
          ⟳ Повтори синхронизацията
        </button>
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="cloudLocalRestore" type="button">
          ↓ Възстанови локално от Cloud
        </button>
      </div>
    </div>

    <div id="pendingOwnership" class="form-msg" hidden>
      Има стари чакащи промени, чийто Cloud профил не може да бъде установен.
      Те няма да бъдат изпратени автоматично.
      <div class="btn-row">
        <button class="btn secondary" id="cloudAssignPending" type="button">
          Свържи чакащите промени с този профил
        </button>
      </div>
    </div>

    <div id="cloudStatus" class="form-msg">
      Данните се съхраняват локално.
    </div>

    <details class="ref-box">
     <summary>Backup & Restore (Cloud архив) <span><span class="chev">▾</span></span></summary>
     <div class="backup-info">
      Пълният архив включва всички автомобилни профили,
      сервизни записи, модификации, разходи, напомняния,
      документи и избраната тема.
     </div>
     <div class="btn-row">
      <button class="btn" id="cloudExport" type="button">
       ↓ Създай пълен Cloud архив
      </button>
     </div>
     <div class="field" style="margin-top:10px">
      <input id="cloudRestoreFile" type="file"
       accept=".json,application/json">
     </div>
     <div class="btn-row">
      <button class="btn secondary" id="cloudRestore" type="button">
       ↥ Възстанови архива във всички устройства
      </button>
     </div>
     <div id="cloudRestoreStatus" class="form-msg">
      Избери архивен JSON файл.
     </div>
    </details>

    <details class="ref-box">
     <summary>Устройства <span><span class="chev">▾</span></span></summary>
     <div class="backup-info">
      Информационен списък на устройствата, използвали профила.
      Това не е функция за отдалечено изключване на устройство.
     </div>
     <div class="device-summary" id="deviceSummary"></div>
     <div class="btn-row">
      <button class="btn secondary" id="cloudDevicesRefresh" type="button">
       ↻ Обнови устройствата
      </button>
     </div>
     <div id="cloudDevicesStatus" class="form-msg">
      Списъкът ще се зареди след вход.
     </div>
     <div id="cloudDevicesList"></div>
    </details>

    <details class="ref-box">
     <summary>История на синхронизациите <span><span class="chev">▾</span></span></summary>
     <div class="btn-row" style="margin-top:0">
      <button class="btn secondary" id="cloudHistoryRefresh" type="button">
       ↻ Обнови историята
      </button>
     </div>
     <div id="cloudHistoryStatus" class="form-msg">
      Историята ще се зареди след вход.
     </div>
     <div id="cloudHistoryList"></div>
    </details>

    <div class="backup-info" style="margin-top:14px">
      M-GARAGE PRO 2.4 · DATA SAFETY & ACCOUNT PROTECTION
    </div>
  `;

  const slot = document.getElementById("cloudSyncSlot");

  if (slot) {
    slot.append(panel);
  } else {
    const rules = document.querySelector(".rules");

    if (rules) {
      rules.after(panel);
    } else {
      document.querySelector(".app")?.append(panel);
    }
  }

  const style = document.createElement("style");

  style.textContent = `
    .cloud-grid {
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:10px;
      margin:14px 0;
    }
    .cloud-card,.device-stat {
      background:var(--surface-2);
      border:1px solid var(--border);
      border-radius:14px;
      padding:12px;
      min-width:0;
    }
    .cloud-label,.device-stat-label {
      font-size:10px;
      font-weight:850;
      letter-spacing:.5px;
      color:var(--muted);
      margin-bottom:6px;
    }
    .cloud-value {
      font-weight:900;
      font-size:14px;
      overflow-wrap:anywhere;
    }
    .cloud-value.small {font-size:12px;line-height:1.5}
    .device-summary {
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:8px;
      margin:12px 0;
    }
    .device-stat-value {font-size:18px;font-weight:900}
    .device-item,.history-item {
      border:1px solid var(--border);
      background:var(--surface);
      border-radius:14px;
      padding:12px;
      margin:9px 0;
    }
    .device-heading,.history-heading {
      display:flex;
      justify-content:space-between;
      gap:8px;
      font-weight:850;
      font-size:13px;
    }
    .device-meta,.history-meta {
      color:var(--muted);
      font-size:11.5px;
      line-height:1.65;
      margin-top:8px;
      overflow-wrap:anywhere;
      white-space:pre-line;
    }
    .device-current,.history-success {color:var(--good);font-weight:900}
    .history-error {color:var(--danger)}
    #pendingOwnership {
      border:1px solid var(--warn);
      background:color-mix(in srgb,var(--warn-soft) 50%,var(--surface-2));
      border-radius:14px;
      padding:12px;
      margin:12px 0;
    }
    #pendingOwnership button {
      white-space:normal;
    }
  `;

  document.head.appendChild(style);

  return panel;
}

createInterface();

const byId = id => document.getElementById(id);

function openCloudPanelForAuth() {
  const panel = byId("cloudSyncPanel");
  if (panel && panel.tagName === "DETAILS") {
    panel.open = true;
  }
}

/* ==========================================
   STATUS & DASHBOARD
========================================== */

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Невалидна дата";

  return date.toLocaleDateString("bg-BG") + " · " +
    date.toLocaleTimeString("bg-BG", {
      hour: "2-digit",
      minute: "2-digit"
    });
}

function readPending() {
  try {
    const data = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");

    if (!Array.isArray(data)) return [];

    return data.filter(event =>
      event &&
      typeof event === "object" &&
      typeof event.event_id === "string" &&
      typeof event.entity_type === "string" &&
      ALLOWED_ENTITY_TYPES.has(event.entity_type) &&
      typeof event.entity_id === "string"
    );
  } catch {
    return [];
  }
}

function inspectPendingStorage() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);

    if (raw === null || raw === "") {
      return {
        ok: true,
        events: []
      };
    }

    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      return {
        ok: false,
        reason: "Опашката не е масив."
      };
    }

    const invalid = data.some(event =>
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      typeof event.event_id !== "string" ||
      !event.event_id.trim() ||
      typeof event.entity_type !== "string" ||
      !ALLOWED_ENTITY_TYPES.has(event.entity_type) ||
      typeof event.entity_id !== "string" ||
      !event.entity_id.trim() ||
      typeof event.operation !== "string" ||
      !event.data ||
      typeof event.data !== "object" ||
      Array.isArray(event.data)
    );

    if (invalid) {
      return {
        ok: false,
        reason: "Открити са невалидни записи в опашката."
      };
    }

    return {
      ok: true,
      events: data
    };

  } catch (error) {
    return {
      ok: false,
      reason:
        "Опашката не може да бъде прочетена: " +
        (error?.message || error)
    };
  }
}

function savePending(events) {
  const safeEvents = Array.isArray(events)
    ? events.filter(event =>
        event &&
        ALLOWED_ENTITY_TYPES.has(event.entity_type)
      )
    : [];

  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify(safeEvents)
    );
  } catch (error) {
    console.error("M-GARAGE PENDING STORAGE:", error);
    throw new Error(
      "Не могат да бъдат запазени чакащите промени. Освободи място в устройството."
    );
  }

  refreshDashboard();
}

function removePendingByIds(ids) {
  if (!ids?.length) return;

  const remove = new Set(ids);

  savePending(
    readPending().filter(event => !remove.has(event.event_id))
  );
}

function pendingForUser(userId) {
  return readPending().filter(
    event => event.owner_user_id === userId
  );
}

function unassignedPending() {
  return readPending().filter(
    event => !event.owner_user_id
  );
}

function foreignPending(userId) {
  return readPending().filter(
    event => event.owner_user_id &&
      event.owner_user_id !== userId
  );
}

function refreshPendingOwnership() {
  const box = byId("pendingOwnership");

  if (!box) return;

  const unassigned = unassignedPending();

  box.hidden = !currentUser || unassigned.length === 0;

  if (unassigned.length) {
    const button = byId("cloudAssignPending");

    if (button) {
      button.textContent =
        "Свържи " + unassigned.length +
        " чакащи промени с този профил";
    }
  }
}

function setIndicator(id, value, color) {
  const element = byId(id);
  if (!element) return;

  element.textContent = value;
  element.style.color = color || "inherit";
}

function refreshPendingDiagnostics() {
  const output = byId("pendingDiagnostics");
  if (!output) return;

  const pending = readPending();

  const counts = {};
  let assigned = 0;
  let unassigned = 0;
  let foreign = 0;

  const lines = [
    "ОБЩО ЧАКАЩИ: " + pending.length,
    "",
    "ПРОФИЛНА ПРИНАДЛЕЖНОСТ:"
  ];

  pending.forEach((event, index) => {
    const key = event.entity_type + " / " + event.operation;
    counts[key] = (counts[key] || 0) + 1;

    if (!event.owner_user_id) {
      unassigned++;
    } else if (
      currentUser &&
      event.owner_user_id === currentUser.id
    ) {
      assigned++;
    } else {
      foreign++;
    }

    const data = safeObject(event.data);

    lines.push(
      "",
      "СЪБИТИЕ " + (index + 1),
      "Тип: " + event.entity_type,
      "Операция: " + event.operation,
      "ID: " + event.entity_id,
      "Цяла снимка (data.car): " + Boolean(data.car),
      "Отделен запис: " + Boolean(data.record),
      "Тип запис: " + safeString(data.recordType, 50),
      "ID запис: " + safeString(data.recordId, 100),
      "Частична промяна (patch): " + Boolean(data.patch)
    );
  });

  lines.splice(
    3, 0,
    "Свързани с текущия профил: " + assigned,
    "Без профил: " + unassigned,
    "Друг профил или неустановен: " + foreign,
    "",
    "ТИП И ОПЕРАЦИЯ:"
  );

  Object.keys(counts).sort().forEach(key => {
    lines.push(key + ": " + counts[key]);
  });

  if (!pending.length) {
    lines.push("Няма валидни чакащи промени.");
  }

  output.textContent = lines.join("\n");
}

function refreshDashboard() {
  const online = navigator.onLine;
  const pending = readPending().length;

  setIndicator(
    "dashboardNetwork",
    online ? "● ONLINE" : "● OFFLINE",
    online ? "var(--good)" : "var(--danger)"
  );

  setIndicator(
    "dashboardPending",
    String(pending),
    pending ? "var(--warn)" : "var(--good)"
  );

  const last = localStorage.getItem(LAST_SYNC_KEY);

  setIndicator(
    "dashboardLastSync",
    last ? formatDate(last) : "Все още няма данни"
  );

  let message = "Не е влязъл";
  let color = "var(--warn)";

  if (syncRunning) {
    message = "Синхронизира...";
    color = "var(--accent)";
  } else if (lastSyncError) {
    message = "Има проблем";
    color = "var(--danger)";
  } else if (currentUser && !online) {
    message = "Изчаква интернет";
  } else if (currentUser && pending) {
    message = "Чакащи промени";
  } else if (currentUser && last) {
    message = "Синхронизирано";
    color = "var(--good)";
  } else if (currentUser) {
    message = "Очаква синхронизация";
    color = "var(--accent)";
  }

  setIndicator("dashboardCloud", "● " + message, color);

  refreshPendingOwnership();
  refreshPendingDiagnostics();
  window.refreshGarageCloudWidget?.();
}

// Съвместимост с основното приложение
window.setCloudSyncStatus = function(state, timestamp) {
  refreshDashboard();
  window.refreshTopCloudButton?.();
};

window.notifyCloudLocalChange = function() {
  refreshDashboard();

  if (readPending().length > 0) {
    scheduleAutomaticSync();
  }
};

function status(message, type = "") {
  const element = byId("cloudStatus");

  if (element) {
    element.textContent = message;
    element.className = "form-msg" + (type ? " " + type : "");
  }

  refreshDashboard();
}

function userStatus(message, type = "") {
  const element = byId("cloudUser");

  if (element) {
    element.textContent = message;
    element.className = "form-msg" + (type ? " " + type : "");
  }

  window.refreshGarageCloudWidget?.();
}

function restoreStatus(message, type = "") {
  const element = byId("cloudRestoreStatus");

  if (element) {
    element.textContent = message;
    element.className = "form-msg" + (type ? " " + type : "");
  }
}

function setBusy(busy) {
  [
    "cloudLogin",
    "cloudRegister",
    "cloudSync",
    "cloudLogout",
    "cloudRetry",
    "cloudLocalRestore",
    "cloudHistoryRefresh",
    "cloudDevicesRefresh",
    "cloudExport",
    "cloudRestore",
    "cloudAssignPending"
  ].forEach(id => {
    const control = byId(id);
    if (!control) return;

    control.disabled = Boolean(busy);
  });

  refreshDashboard();
}

/* ==========================================
   LOCAL DATA
========================================== */

function readLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return {
      cars: cleanCars(raw ? JSON.parse(raw) : []),
      activeVin: localStorage.getItem(ACTIVE_KEY) || "",
      theme: localStorage.getItem(THEME_KEY) || "dark"
    };
  } catch {
    throw new Error("Не могат да бъдат прочетени локалните данни.");
  }
}

function createEvent(entityType, entityId, operation, data) {
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    throw new Error(
      "Недопустим тип Cloud събитие: " + entityType
    );
  }

  return {
    event_id: crypto.randomUUID
      ? crypto.randomUUID()
      : "evt-" + Date.now() + "-" +
        Math.random().toString(36).slice(2),
    device_id: DEVICE_ID,
    entity_type: entityType,
    entity_id: entityId,
    operation,
    data,
    owner_user_id: currentUser?.id || null
  };
}

function enqueueEvents(events) {
  if (!events.length) return;

  const validEvents = events.filter(event =>
    event &&
    ALLOWED_ENTITY_TYPES.has(event.entity_type)
  );

  if (!validEvents.length) return;

  const pending = readPending();
  const ownerId = currentUser?.id || null;

  const tagged = validEvents.map(event => ({
    ...event,
    owner_user_id: ownerId
  }));

  pending.push(...tagged);

  savePending(pending);
  scheduleAutomaticSync();
}

/* ==========================================
   PENDING ACCOUNT PROTECTION
========================================== */

function assignPendingToCurrentUser() {
  if (!currentUser) {
    status("Първо влез в Cloud профила.");
    return;
  }

  const pending = readPending();
  const unassigned = pending.filter(event => !event.owner_user_id);

  if (!unassigned.length) {
    status("Няма неприсвоени чакащи промени.");
    return;
  }

  const foreign = foreignPending(currentUser.id);

  if (foreign.length) {
    status(
      "Има промени, свързани с друг Cloud профил. Те няма да бъдат прехвърлени."
    );
    return;
  }

  if (!confirm(
    "Ще свържеш " + unassigned.length +
    " стари чакащи промени с профила:\n\n" +
    currentUser.email +
    "\n\nПродължаваме ли?"
  )) return;

  const updated = pending.map(event => {
    if (!event.owner_user_id) {
      return {
        ...event,
        owner_user_id: currentUser.id
      };
    }

    return event;
  });

  try {
    savePending(updated);
    refreshPendingOwnership();

    status(
      "Чакащите промени са свързани с текущия профил.",
      "ok"
    );

    scheduleAutomaticSync(500);
  } catch (error) {
    status(error.message);
  }
}

/* ==========================================
   LOCAL CHANGE DETECTION
========================================== */

function compareCars(oldInput, newInput) {
  const oldCars = cleanCars(oldInput);
  const newCars = cleanCars(newInput);

  const oldMap = new Map(oldCars.map(car => [car.vin, car]));
  const newMap = new Map(newCars.map(car => [car.vin, car]));

  const events = [];

  oldMap.forEach((oldCar, vin) => {
    if (!newMap.has(vin)) {
      events.push(createEvent("car", vin, "delete", {}));
    }
  });

  newMap.forEach((newCar, vin) => {
    const oldCar = oldMap.get(vin);

    if (!oldCar || stableJSON(oldCar) !== stableJSON(newCar)) {
      events.push(
        createEvent("car", vin, "upsert", {
          car: newCar,
          nick: newCar.nick
        })
      );
    }
  });

  return events;
}

/* ==========================================
   WATCH LOCAL STORAGE
========================================== */

const originalSetItem = Storage.prototype.setItem;
const originalGetItem = Storage.prototype.getItem;

Storage.prototype.setItem = function(key, value) {
  if (this !== localStorage || suppressLocalEvents) {
    return originalSetItem.call(this, key, value);
  }

  if (key === STORAGE_KEY) {
    let oldCars = [];

    try {
      const oldRaw = originalGetItem.call(this, key);
      oldCars = oldRaw ? JSON.parse(oldRaw) : [];
    } catch {
      oldCars = [];
    }

    const result = originalSetItem.call(this, key, value);

    try {
      enqueueEvents(compareCars(oldCars, JSON.parse(value)));
    } catch (error) {
      console.error("Cloud change detection:", error);
    }

    return result;
  }

  if (key === ACTIVE_KEY) {
    const oldVin = originalGetItem.call(this, key) || "";
    const result = originalSetItem.call(this, key, value);
    const newVin = String(value || "");

    if (oldVin !== newVin) {
      enqueueEvents([
        createEvent("active", "active", "set", { vin: newVin })
      ]);
    }

    return result;
  }

  return originalSetItem.call(this, key, value);
};

/* ==========================================
   SAVE CLOUD DATA LOCALLY
========================================== */

function saveLocalData(data) {
  try {
    suppressLocalEvents = true;

    originalSetItem.call(
      localStorage,
      STORAGE_KEY,
      JSON.stringify(cleanCars(data.cars))
    );

    originalSetItem.call(
      localStorage,
      ACTIVE_KEY,
      data.activeVin || ""
    );

    if (data.theme === "light" || data.theme === "dark") {
      originalSetItem.call(localStorage, THEME_KEY, data.theme);
    }
  } catch {
    throw new Error("Неуспешно запазване на локалните данни.");
  } finally {
    suppressLocalEvents = false;
  }

  if (
    (data.theme === "light" || data.theme === "dark") &&
    typeof window.setTheme === "function"
  ) {
    window.setTheme(data.theme);
  }
}

/* ==========================================
   BACKUP
========================================== */

function createBackup() {
  const local = readLocalData();

  return {
    app: "M-GARAGE PRO",
    version: 4,
    archiveType: "full",
    exportedAt: new Date().toISOString(),
    cars: local.cars,
    activeVin: local.activeVin,
    theme: local.theme
  };
}

function downloadBackup() {
  try {
    const backup = createBackup();

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download =
      "M-GARAGE-PRO-backup-" +
      new Date().toISOString().slice(0, 10) +
      ".json";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    restoreStatus("Пълният архив е създаден успешно.", "ok");
  } catch (error) {
    restoreStatus("Грешка при архива: " + error.message);
  }
}

function validateBackup(raw) {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Файлът не съдържа валиден JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error("Невалидна структура на архива.");
  }

  if (parsed.app !== "M-GARAGE PRO") {
    throw new Error("Архивът не е от M-GARAGE PRO.");
  }

  if (!Array.isArray(parsed.cars)) {
    throw new Error("В архива липсва списък с автомобили.");
  }

  const cars = cleanCars(parsed.cars);

  if (parsed.cars.length && !cars.length) {
    throw new Error("Не е намерен автомобил с валиден VIN.");
  }

  const requested = safeString(parsed.activeVin, 17).toUpperCase();

  const activeVin = cars.some(car => car.vin === requested)
    ? requested
    : (cars[0]?.vin || "");

  return {
    version: Number(parsed.version) || 1,
    cars,
    activeVin,
    theme: parsed.theme === "light" ? "light" : "dark"
  };
}

/* ==========================================
   CLOUD EVENT FETCH
========================================== */

async function fetchAllEvents(userId) {
  const all = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("user_changes")
      .select(
        "event_id,event_order,device_id,entity_type,entity_id,operation,data,created_at"
      )
      .eq("user_id", userId)
      .order("event_order", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    if (data?.length) all.push(...data);

    if (!data || data.length < pageSize) break;

    offset += pageSize;
  }

  return all;
}

async function uploadEvents(userId, events) {
  if (!events.length) return;

  const invalid = events.filter(event =>
    !event ||
    !ALLOWED_ENTITY_TYPES.has(event.entity_type)
  );

  if (invalid.length) {
    throw new Error(
      "Блокирано е изпращане на несъвместими Cloud събития."
    );
  }

  const rows = events.map(event => ({
    event_id: event.event_id,
    user_id: userId,
    device_id: event.device_id,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    operation: event.operation,
    data: event.data
  }));

  const { error } = await supabase
    .from("user_changes")
    .upsert(rows, {
      onConflict: "event_id",
      ignoreDuplicates: true
    });

  if (error) throw error;
}

async function uploadPending(userId) {
  const pending = readPending();

  if (!pending.length) return 0;

  const foreign = foreignPending(userId);

  if (foreign.length) {
    throw new Error(
      "Има " + foreign.length +
      " чакащи промени от друг Cloud профил. Те са запазени и няма да бъдат изпратени."
    );
  }

  const unassigned = unassignedPending();

  if (unassigned.length) {
    throw new Error(
      "Има " + unassigned.length +
      " стари неприсвоени промени. Свържи ги с текущия профил от панела Cloud Sync."
    );
  }

  const owned = pendingForUser(userId);

  if (!owned.length) return 0;

  const sendingIds = new Set(
    owned.map(event => event.event_id)
  );

  await uploadEvents(userId, owned);

  removePendingByIds(Array.from(sendingIds));

  return owned.length;
}

/* ==========================================
   LEGACY DATA
========================================== */

async function readLegacyData(userId) {
  const { data, error } = await supabase
    .from("user_data")
    .select("payload,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return data?.payload || {};
}

function createInitialEvents(events, local, legacy) {
  const knownCars = new Set();

  events.forEach(event => {
    if (event.entity_type === "car") {
      knownCars.add(event.entity_id);
    }
  });

  const combined = new Map();

  cleanCars(legacy.cars || []).forEach(car => {
    combined.set(car.vin, car);
  });

  cleanCars(local.cars || []).forEach(car => {
    combined.set(car.vin, car);
  });

  const initial = [];

  combined.forEach(car => {
    if (knownCars.has(car.vin)) return;

    initial.push(
      createEvent("car", car.vin, "upsert", {
        car,
        nick: car.nick
      })
    );
  });

  const hasActive = events.some(
    event => event.entity_type === "active"
  );

  if (!hasActive) {
    initial.push(
      createEvent("active", "active", "set", {
        vin: local.activeVin || legacy.activeVin || ""
      })
    );
  }

  return initial;
}

/* ==========================================
   APPLY EVENTS
========================================== */

function applyEvents(events) {
  const cars = new Map();
  let activeVin = "";
  let theme = "dark";

  events.forEach(event => {
    const type = event.entity_type;
    const id = event.entity_id;
    const data = safeObject(event.data);

    if (type === "restore") {
      cars.clear();

      cleanCars(data.cars || []).forEach(car => {
        cars.set(car.vin, car);
      });

      activeVin = safeString(data.activeVin, 17);
      theme = data.theme === "light" ? "light" : "dark";

      return;
    }

    if (type === "car") {
      if (event.operation === "delete") {
        cars.delete(id);
        return;
      }

      if (event.operation === "upsert") {
        if (data.car) {
          const snapshot = cleanCar(data.car);

          if (snapshot && snapshot.vin === id) {
            cars.set(id, snapshot);
            return;
          }
        }

        const existing = cars.get(id) || cleanCar({
          vin: id,
          nick: "BMW",
          done: {}
        });

        if (!existing) return;

        existing.nick = safeString(
          data.nick || existing.nick || "BMW",
          30
        ) || "BMW";

        cars.set(id, existing);
      }

      return;
    }

    if (type === "step") {
      const separator = id.lastIndexOf(":");

      if (separator < 0) return;

      const vin = id.slice(0, separator);
      const stepId = id.slice(separator + 1);

      if (!STEP_IDS.includes(stepId)) return;

      const car = cars.get(vin);
      if (!car) return;

      if (data.done === true) {
        car.done[stepId] = true;
      } else {
        delete car.done[stepId];
      }

      return;
    }

    if (type === "active") {
      activeVin = safeString(data.vin, 17);
      return;
    }
  });

  const resultCars = Array.from(cars.values());

  if (!resultCars.some(car => car.vin === activeVin)) {
    activeVin = resultCars[0]?.vin || "";
  }

  return {
    cars: resultCars,
    activeVin,
    theme
  };
}

function getLatestRestore(events) {
  let latest = null;

  events.forEach(event => {
    if (event.entity_type === "restore") latest = event;
  });

  return latest;
}

async function restoreLocalFromCloud() {
  if (syncRunning) {
    status("Изчакай текущата операция.");
    return;
  }

  if (!navigator.onLine) {
    status("Необходима е интернет връзка.");
    return;
  }

  if (!currentUser) {
    status("Първо влез в Cloud профила.");
    return;
  }

  const pendingCheck = inspectPendingStorage();

  if (!pendingCheck.ok) {
    status(
      "Възстановяването е спряно: " + pendingCheck.reason
    );
    return;
  }

  const foreign = foreignPending(currentUser.id);
  const unassigned = unassignedPending();

  if (foreign.length || unassigned.length) {
    status(
      "Възстановяването е спряно: има чакащи промени без собственик или от друг профил."
    );
    return;
  }

  syncRunning = true;
  setBusy(true);
  status("Проверка на облачните данни...");

  try {
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    if (!session || session.user.id !== currentUser.id) {
      throw new Error(
        "Cloud профилът не съвпада с активната сесия."
      );
    }

    status("Прочитане на облачната история...");

    const events = await fetchAllEvents(session.user.id);

    if (!events.length) {
      throw new Error("В Cloud не са намерени събития.");
    }

    const restored = applyEvents(events);
    const totalDocs = restored.cars.reduce(
      (sum, car) => sum + (Array.isArray(car.documents) ? car.documents.length : 0),
      0
    );

    const latestRestore = getLatestRestore(events);

    const {
      data: { session: currentSession },
      error: currentSessionError
    } = await supabase.auth.getSession();

    if (currentSessionError) throw currentSessionError;

    if (
      !currentSession ||
      currentSession.user.id !== session.user.id ||
      !currentUser ||
      currentUser.id !== session.user.id
    ) {
      throw new Error(
        "Cloud профилът се е променил. Записът е отменен."
      );
    }

    if (!confirm(
      "ПРОВЕРКАТА Е УСПЕШНА\n\n" +
      "Автомобили в Cloud: " + restored.cars.length + "\n" +
      "Документи общо: " + totalDocs + "\n\n" +
      "Ще бъдат заменени локалните данни на това устройство с данните от Cloud.\n\n" +
      "Продължаваме ли?"
    )) {
      status("Локалното възстановяване е отказано.");
      return;
    }

    const finalPendingCheck = inspectPendingStorage();

    if (!finalPendingCheck.ok) {
      throw new Error(
        "Опашката не може да бъде проверена. Записът е отменен: " +
        finalPendingCheck.reason
      );
    }

    const storageKeys = [
      STORAGE_KEY,
      ACTIVE_KEY,
      THEME_KEY,
      RESTORE_KEY
    ];

    const previousStorage = new Map(
      storageKeys.map(key => [
        key,
        originalGetItem.call(localStorage, key)
      ])
    );

    try {
      saveLocalData(restored);

      if (latestRestore?.event_id) {
        originalSetItem.call(
          localStorage,
          RESTORE_KEY,
          latestRestore.event_id
        );
      }
    } catch (writeError) {
      const rollbackErrors = [];

      suppressLocalEvents = true;

      try {
        storageKeys.forEach(key => {
          try {
            const previousValue = previousStorage.get(key);

            if (previousValue === null) {
              Storage.prototype.removeItem.call(
                localStorage,
                key
              );
            } else {
              originalSetItem.call(
                localStorage,
                key,
                previousValue
              );
            }
          } catch (rollbackError) {
            rollbackErrors.push(
              key + ": " +
              (rollbackError?.message || rollbackError)
            );
          }
        });
      } finally {
        suppressLocalEvents = false;
      }

      try {
        const previousTheme =
          previousStorage.get(THEME_KEY) || "dark";

        if (typeof window.setTheme === "function") {
          window.setTheme(previousTheme);
        }
      } catch (themeError) {
        rollbackErrors.push(
          "Тема: " + (themeError?.message || themeError)
        );
      }

      if (rollbackErrors.length) {
        throw new Error(
          "Записът е неуспешен и възстановяването на предишните " +
          "локални стойности има проблем: " +
          rollbackErrors.join("; ") +
          ". Първоначална грешка: " +
          (writeError?.message || writeError)
        );
      }

      throw new Error(
        "Записът е неуспешен. Предишните локални данни са " +
        "възстановени. Причина: " +
        (writeError?.message || writeError)
      );
    }

    window.renderAll?.();

    status(
      "Локалното възстановяване е успешно. " +
      "Автомобили: " + restored.cars.length +
      ". Документи: " + totalDocs + ".",
      "ok"
    );

  } catch (error) {
    console.error("M-GARAGE LOCAL CLOUD RECOVERY:", error);

    status(
      await diagnoseCloudError(
        error,
        "Грешка при локално възстановяване"
      )
    );

  } finally {
    syncRunning = false;
    setBusy(false);
    refreshDashboard();
  }
}

/* ==========================================
   HISTORY
========================================== */

async function writeHistory(
  userId,
  result,
  carsCount,
  changesCount,
  errorMessage = ""
) {
  const { error } = await supabase
    .from("sync_history")
    .insert({
      user_id: userId,
      device_id: DEVICE_ID,
      device_name: getDeviceName(),
      result,
      cars_count: carsCount,
      changes_count: changesCount,
      error_message: errorMessage
        ? safeString(errorMessage, 500)
        : null
    });

  if (error) throw error;
}

function renderHistory(items) {
  const container = byId("cloudHistoryList");
  if (!container) return;

  container.replaceChildren();

  if (!items.length) {
    byId("cloudHistoryStatus").textContent =
      "Все още няма записи в историята.";
    return;
  }

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "history-item";

    const heading = document.createElement("div");
    heading.className = "history-heading";

    const result = document.createElement("span");
    result.className = item.result === "success"
      ? "history-success"
      : "history-error";

    result.textContent = item.result === "success"
      ? "✓ Успешна синхронизация"
      : "✕ Неуспешна синхронизация";

    const device = document.createElement("span");
    device.textContent = item.device_name || "Устройство";

    heading.append(result, device);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent =
      formatDate(item.created_at) +
      "\nАвтомобили: " + item.cars_count +
      " · Промени: " + item.changes_count;

    card.append(heading, meta);

    if (item.error_message) {
      const error = document.createElement("div");
      error.className = "history-meta history-error";
      error.textContent = "Причина: " + item.error_message;
      card.append(error);
    }

    container.append(card);
  });

  byId("cloudHistoryStatus").textContent =
    "Показани са последните " + items.length + " записа.";
}

async function loadHistory() {
  if (!currentUser) return;

  byId("cloudHistoryStatus").textContent = "Зареждане...";

  try {
    const { data, error } = await supabase
      .from("sync_history")
      .select(
        "id,device_id,device_name,result,cars_count,changes_count,error_message,created_at"
      )
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(30);

    if (error) throw error;

    renderHistory(data || []);
  } catch (error) {
    byId("cloudHistoryStatus").textContent =
      await diagnoseCloudError(error, "Грешка при зареждане на историята");
  }
}

/* ==========================================
   DEVICES
========================================== */

function renderDevices(items) {
  const container = byId("cloudDevicesList");
  const summary = byId("deviceSummary");

  if (!container || !summary) return;

  container.replaceChildren();
  summary.replaceChildren();

  const map = new Map();

  items.forEach(item => {
    if (!item.device_id) return;

    let device = map.get(item.device_id);

    if (!device) {
      device = {
        device_id: item.device_id,
        name: item.device_name || "Старо устройство",
        lastSeen: item.created_at,
        lastResult: item.result,
        total: 0,
        success: 0,
        errors: 0
      };

      map.set(item.device_id, device);
    }

    device.total++;

    if (item.result === "success") device.success++;
    if (item.result === "error") device.errors++;

    if (new Date(item.created_at) > new Date(device.lastSeen)) {
      device.lastSeen = item.created_at;
      device.lastResult = item.result;
      device.name = item.device_name || device.name;
    }
  });

  const devices = Array.from(map.values()).sort(
    (a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)
  );

  const stats = [
    ["УСТРОЙСТВА", devices.length],
    ["ТЕКУЩО", devices.filter(d => d.device_id === DEVICE_ID).length],
    ["УСПЕШНИ", devices.reduce((sum, d) => sum + d.success, 0)],
    ["ГРЕШКИ", devices.reduce((sum, d) => sum + d.errors, 0)]
  ];

  stats.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "device-stat";

    const title = document.createElement("div");
    title.className = "device-stat-label";
    title.textContent = label;

    const number = document.createElement("div");
    number.className = "device-stat-value";
    number.textContent = String(value);

    card.append(title, number);
    summary.append(card);
  });

  if (!devices.length) {
    container.textContent = "Все още няма регистрирани устройства.";
    byId("cloudDevicesStatus").textContent = "Няма намерени записи.";
    return;
  }

  devices.forEach(device => {
    const card = document.createElement("div");
    card.className = "device-item";

    const heading = document.createElement("div");
    heading.className = "device-heading";

    const name = document.createElement("span");
    name.textContent = device.name;

    const current = document.createElement("span");

    if (device.device_id === DEVICE_ID) {
      current.className = "device-current";
      current.textContent = "ТЕКУЩО";
    }

    heading.append(name, current);

    const meta = document.createElement("div");
    meta.className = "device-meta";

    meta.textContent =
      "Последна активност: " + formatDate(device.lastSeen) +
      "\nОбщо: " + device.total +
      " · Успешни: " + device.success +
      " · Грешки: " + device.errors +
      "\nID: " + device.device_id;

    card.append(heading, meta);
    container.append(card);
  });

  byId("cloudDevicesStatus").textContent =
    "Намерени устройства: " + devices.length +
    ". Данните са обобщени от последните записи.";
}

async function loadDevices() {
  if (!currentUser) return;

  byId("cloudDevicesStatus").textContent = "Зареждане...";

  try {
    const { data, error } = await supabase
      .from("sync_history")
      .select("id,device_id,device_name,result,created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(3000);

    if (error) throw error;

    renderDevices(data || []);
  } catch (error) {
    byId("cloudDevicesStatus").textContent =
      await diagnoseCloudError(error, "Грешка при зареждане на устройствата");
  }
}

/* ==========================================
   CLOUD RESTORE
========================================== */

async function restoreBackup() {
  if (syncRunning) {
    restoreStatus("Изчакай текущата синхронизация.");
    return;
  }

  const file = byId("cloudRestoreFile")?.files?.[0];

  if (!file) {
    restoreStatus("Първо избери архивен JSON файл.");
    return;
  }

  if (!navigator.onLine) {
    restoreStatus("За Cloud възстановяване е необходим интернет.");
    return;
  }

  if (!currentUser) {
    restoreStatus("Първо влез в Cloud профила.");
    return;
  }

  if (!confirm(
    "ВНИМАНИЕ!\n\n" +
    "Архивът ще замени текущия гараж в Cloud профила " +
    "и на останалите устройства.\n\nПродължаваме ли?"
  )) return;

  setBusy(true);
  syncRunning = true;
  lastSyncError = false;
  window.setCloudSyncStatus?.("syncing");

  let uploaded = false;

  try {
    const backup = validateBackup(await file.text());

    if (
      backup.cars.length === 0 &&
      !confirm(
        "Архивът е с празен гараж.\n" +
        "Всички автомобили ще бъдат премахнати от Cloud профила.\n\nСигурен ли си?"
      )
    ) {
      restoreStatus("Възстановяването е отказано.");
      window.setCloudSyncStatus?.("synced", localStorage.getItem(LAST_SYNC_KEY) || new Date().toISOString());
      return;
    }

    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;
    if (!session) throw new Error("Cloud сесията е изтекла.");

    if (session.user.id !== currentUser.id) {
      throw new Error(
        "Cloud профилът се промени. Влез отново и повтори операцията."
      );
    }

    const foreign = foreignPending(session.user.id);
    const unassigned = unassignedPending();

    if (foreign.length || unassigned.length) {
      throw new Error(
        "Има чакащи промени, които не са свързани с този профил. " +
        "Първо провери собствеността им."
      );
    }

    restoreStatus("Качване на чакащите промени...");

    await uploadPending(session.user.id);

    restoreStatus("Качване на архива в Cloud...");

    const restoreEvent = createEvent(
      "restore",
      "snapshot",
      "set",
      {
        archiveVersion: backup.version,
        cars: backup.cars,
        activeVin: backup.activeVin,
        theme: backup.theme,
        restoredAt: new Date().toISOString()
      }
    );

    await uploadEvents(session.user.id, [restoreEvent]);

    uploaded = true;

    restoreStatus("Прилагане на възстановените данни...");

    const events = await fetchAllEvents(session.user.id);
    const restored = applyEvents(events);

    saveLocalData(restored);

    const finishedIso = new Date().toISOString();
    localStorage.setItem(RESTORE_KEY, restoreEvent.event_id);
    localStorage.setItem(LAST_SYNC_KEY, finishedIso);

    window.renderAll?.();
    window.setCloudSyncStatus?.("synced", finishedIso);

    try {
      await writeHistory(
        session.user.id,
        "success",
        restored.cars.length,
        1
      );

      await loadHistory();
      await loadDevices();
    } catch (error) {
      console.error("Restore history:", error);
    }

    restoreStatus(
      "Архивът е възстановен успешно. Автомобили: " +
      restored.cars.length + ".",
      "ok"
    );

    status(
      "Cloud възстановяването е успешно. Останалите устройства ще получат данните при следваща синхронизация.",
      "ok"
    );

  } catch (error) {
    console.error("M-GARAGE RESTORE:", error);
    lastSyncError = true;
    window.setCloudSyncStatus?.("error");

    const diag = await diagnoseCloudError(error, "Грешка при възстановяване");

    restoreStatus(
      uploaded
        ? "Архивът е качен в Cloud, но локалното прилагане не завърши. Натисни синхронизация."
        : diag + ". Чакащите промени са запазени."
    );

    status("Възстановяването не беше завършено.");
  } finally {
    syncRunning = false;
    setBusy(false);
    refreshDashboard();
  }
}

/* ==========================================
   AUTHENTICATION
========================================== */

function showAuthenticated(user) {
  if (!user) return;

  const changedUser = currentUser?.id !== user.id;

  currentUser = user;

  if (byId("cloudAuthForm")) byId("cloudAuthForm").hidden = true;
  if (byId("cloudActions")) byId("cloudActions").hidden = false;

  userStatus("Влязъл потребител: " + user.email, "ok");

  if (changedUser) {
    status("Cloud профилът е активен. Зареждане на данните...");
    loadHistory();
    loadDevices();
  }

  refreshPendingOwnership();
}

function showLoggedOut() {
  currentUser = null;

  if (byId("cloudAuthForm")) byId("cloudAuthForm").hidden = false;
  if (byId("cloudActions")) byId("cloudActions").hidden = true;

  userStatus("Влез с акаунта си, за да синхронизираш и възстановиш данните.");

  if (byId("cloudHistoryStatus")) {
    byId("cloudHistoryStatus").textContent =
      "Влез в профила си, за да видиш историята.";
  }

  if (byId("cloudDevicesStatus")) {
    byId("cloudDevicesStatus").textContent =
      "Влез в профила си, за да видиш устройствата.";
  }

  byId("cloudHistoryList")?.replaceChildren();
  byId("cloudDevicesList")?.replaceChildren();
  byId("deviceSummary")?.replaceChildren();

  refreshPendingOwnership();
  openCloudPanelForAuth();

  status("Очаква се вход с имейл и парола.");
}

async function register() {
  const email = (byId("cloudEmail")?.value || "").trim();
  const password = byId("cloudPassword")?.value || "";

  if (!email || password.length < 6) {
    status("Въведи валиден имейл и парола от минимум 6 символа.");
    return;
  }

  setBusy(true);
  status("Изпращане на регистрация...");

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    if (data.session) {
      showAuthenticated(data.user);
      status("Регистрацията е успешна.", "ok");
      scheduleAutomaticSync(600);
    } else {
      status("Регистрацията е приета. Провери имейла си.");
    }
  } catch (error) {
    lastSyncError = true;
    status(await diagnoseCloudError(error, "Грешка при регистрация"));
  } finally {
    setBusy(false);
  }
}

async function login() {
  const email = (byId("cloudEmail")?.value || "").trim();
  const password = byId("cloudPassword")?.value || "";

  if (!email || !password) {
    status("Въведи имейл и парола.");
    return;
  }

  setBusy(true);
  status("Свързване със сървъра и проверка на профила...");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    lastSyncError = false;
    showAuthenticated(data.user);
    status("Входът е успешен. Възстановяване на данните...", "ok");

    scheduleAutomaticSync(500);
  } catch (error) {
    lastSyncError = true;
    status(await diagnoseCloudError(error, "Грешка при вход"));
  } finally {
    setBusy(false);
  }
}

async function logout() {
  if (readPending().length) {
    if (!confirm(
      "Има чакащи локални промени.\n\n" +
      "Те ще останат на това устройство и няма да бъдат изтрити.\n\n" +
      "Сигурен ли си, че искаш да излезеш?"
    )) return;
  }

  setBusy(true);

  try {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    showLoggedOut();
    status("Излезе от Cloud Sync.", "ok");
  } catch (error) {
    status(await diagnoseCloudError(error, "Грешка при изход"));
  } finally {
    setBusy(false);
  }
}

/* ==========================================
   MAIN SYNC
========================================== */

async function syncNow() {
  if (syncRunning) return;

  if (!navigator.onLine) {
    lastSyncError = true;
    window.setCloudSyncStatus?.("error");
    status(
      "Няма интернет. Промените са запазени локално и чакат синхронизация."
    );
    return;
  }

  syncRunning = true;
  lastSyncError = false;
  window.setCloudSyncStatus?.("syncing");

  setBusy(true);
  status("Синхронизацията започна...");

  let historyUserId = null;
  let processedChanges = 0;
  let mergedCarsCount = 0;

  try {
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;
    if (!session) throw new Error("Не си влязъл в профила.");

    const userId = session.user.id;
    historyUserId = userId;

    if (currentUser && currentUser.id !== userId) {
      throw new Error(
        "Активният Cloud профил се промени. Влез отново."
      );
    }

    const foreign = foreignPending(userId);

    if (foreign.length) {
      throw new Error(
        "Има " + foreign.length +
        " чакащи промени от друг Cloud профил. Те са запазени."
      );
    }

    if (unassignedPending().length) {
      throw new Error(
        "Има стари чакащи промени без собственик. " +
        "Провери ги и ги свържи с текущия профил."
      );
    }

    let events = await fetchAllEvents(userId);

    const latestRestore = getLatestRestore(events);
    const localRestoreId = localStorage.getItem(RESTORE_KEY);

    if (
      latestRestore &&
      latestRestore.event_id !== localRestoreId
    ) {
      const pending = pendingForUser(userId);

      if (pending.length) {
        const proceed = confirm(
          "Открит е архив, възстановен от друго устройство.\n\n" +
          "Има " + pending.length +
          " локални чакащи промени.\n\n" +
          "Ако продължиш, първо ще се приложи архивът, " +
          "след което локалните чакащи промени ще бъдат изпратени " +
          "като по-нови събития.\n\nПродължаваме ли?"
        );

        if (!proceed) {
          status(
            "Синхронизацията е спряна. Локалните промени са запазени."
          );
          window.setCloudSyncStatus?.("pending");
          return;
        }
      }

      const restored = applyEvents(events);

      saveLocalData(restored);
      localStorage.setItem(RESTORE_KEY, latestRestore.event_id);

      mergedCarsCount = restored.cars.length;
      processedChanges = 1;

      processedChanges += await uploadPending(userId);

      events = await fetchAllEvents(userId);

      const merged = applyEvents(events);

      saveLocalData(merged);
      mergedCarsCount = merged.cars.length;

      window.renderAll?.();

    } else {
      const local = readLocalData();
      const legacy = await readLegacyData(userId);

      const initial = createInitialEvents(events, local, legacy);

      if (initial.length) {
        await uploadEvents(userId, initial);
        processedChanges += initial.length;
      }

      processedChanges += await uploadPending(userId);

      events = await fetchAllEvents(userId);

      const merged = applyEvents(events);

      mergedCarsCount = merged.cars.length;

      saveLocalData(merged);

      const finalRestore = getLatestRestore(events);

      if (finalRestore) {
        localStorage.setItem(RESTORE_KEY, finalRestore.event_id);
      }

      if (typeof window.renderAll === "function") {
        window.renderAll();
      } else {
        window.location.reload();
        return;
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();

    localStorage.setItem(LAST_SYNC_KEY, nowIso);

    lastSyncError = false;
    window.setCloudSyncStatus?.("synced", nowIso);

    let historyMessage = "";

    try {
      await writeHistory(
        userId,
        "success",
        mergedCarsCount,
        processedChanges
      );

      await loadHistory();
      await loadDevices();
    } catch (historyError) {
      console.error("M-GARAGE HISTORY WRITE:", historyError);
      historyMessage = " Историята не можа да бъде записана.";
    }

    status(
      "Синхронизацията е успешна. Автомобили: " +
      mergedCarsCount +
      ". Промени: " +
      processedChanges +
      ". " +
      now.toLocaleString("bg-BG") +
      "." +
      historyMessage,
      "ok"
    );

  } catch (error) {
    console.error("M-GARAGE CLOUD SYNC:", error);

    lastSyncError = true;
    window.setCloudSyncStatus?.("error");

    const diag = await diagnoseCloudError(error, "Грешка при синхронизация");

    if (historyUserId) {
      try {
        await writeHistory(
          historyUserId,
          "error",
          mergedCarsCount,
          processedChanges,
          diag
        );

        await loadHistory();
        await loadDevices();
      } catch (historyError) {
        console.error("M-GARAGE HISTORY ERROR:", historyError);
      }
    }

    status(diag);

  } finally {
    syncRunning = false;
    setBusy(false);
    refreshDashboard();
  }
}

/* ==========================================
   AUTOMATIC SYNC
========================================== */

function scheduleAutomaticSync(delay = 1800) {
  if (syncTimer) clearTimeout(syncTimer);

  syncTimer = setTimeout(async () => {
    if (!navigator.onLine) {
      refreshDashboard();
      return;
    }

    try {
      const {
        data: { session },
        error
      } = await supabase.auth.getSession();

      if (error) throw error;

      if (session) {
        if (!currentUser) {
          showAuthenticated(session.user);
        }

        if (currentUser?.id === session.user.id) {
          await syncNow();
        }
      }
    } catch (error) {
      console.error("M-GARAGE AUTO SYNC:", error);
      lastSyncError = true;
      window.setCloudSyncStatus?.("error");
      refreshDashboard();
    }
  }, delay);
}

/* ==========================================
   NETWORK & VISIBILITY
========================================== */

window.addEventListener("online", () => {
  lastSyncError = false;
  status("Интернетът е възстановен. Започва синхронизация...");
  scheduleAutomaticSync(500);
});

window.addEventListener("offline", () => {
  status("Няма интернет. Локалните промени се запазват.");
  refreshDashboard();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && navigator.onLine) {
    scheduleAutomaticSync(1000);
  }

  refreshDashboard();
});

/* ==========================================
   EVENTS
========================================== */

byId("cloudLogin")?.addEventListener("click", login);
byId("cloudRegister")?.addEventListener("click", register);
byId("cloudLogout")?.addEventListener("click", logout);
byId("cloudSync")?.addEventListener("click", syncNow);
byId("cloudRetry")?.addEventListener("click", syncNow);
byId("cloudLocalRestore")?.addEventListener(
  "click",
  restoreLocalFromCloud
);
byId("cloudHistoryRefresh")?.addEventListener("click", loadHistory);
byId("cloudDevicesRefresh")?.addEventListener("click", loadDevices);
byId("cloudExport")?.addEventListener("click", downloadBackup);
byId("cloudRestore")?.addEventListener("click", restoreBackup);
byId("cloudAssignPending")?.addEventListener(
  "click",
  assignPendingToCurrentUser
);

/* ==========================================
   AUTH STATE
========================================== */

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    const changedUser = currentUser?.id !== session.user.id;

    showAuthenticated(session.user);

    if (
      (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
      (!initialSyncTriggered || event === "SIGNED_IN")
    ) {
      initialSyncTriggered = true;
      scheduleAutomaticSync(600);
    }

    if (changedUser) {
      refreshPendingOwnership();
    }
  } else {
    initialSyncTriggered = false;
    showLoggedOut();
  }

  authInitialized = true;
  refreshDashboard();
});

/* ==========================================
   INITIALIZATION
========================================== */

async function initializeCloud() {
  refreshDashboard();

  try {
    const {
      data: { session },
      error
    } = await supabase.auth.getSession();

    if (error) throw error;

    if (session) {
      showAuthenticated(session.user);
    } else {
      showLoggedOut();
    }
  } catch (error) {
    lastSyncError = true;
    window.setCloudSyncStatus?.("error");
    userStatus("Cloud Sync не е достъпен.");
    status(await diagnoseCloudError(error, "Грешка при инициализация"));
  }

  refreshDashboard();
}

initializeCloud();
