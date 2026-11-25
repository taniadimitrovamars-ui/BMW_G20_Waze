
"use strict";

/* ==========================================
   M-GARAGE PRO
   CLOUD SYNC MODULE
   Version: 1.4
========================================== */

import { createClient } from
  "https://esm.sh/@supabase/supabase-js@2";

/* SUPABASE CONFIGURATION */

const SUPABASE_URL =
  "https://xmyxrxunhasoxosqlkws.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_XJA2QPDo1GOZ34a_ZA3Xtg_a9vk_7Sn";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

/* LOCAL STORAGE KEYS */

const STORAGE_KEY = "mgu_cars";
const ACTIVE_KEY = "mgu_active";
const PENDING_KEY = "mgu_cloud_pending";
const DEVICE_KEY = "mgu_cloud_device";
const LAST_SYNC_KEY = "mgu_cloud_last_sync";

const STEP_IDS = [
  "prep",
  "backup",
  "enable",
  "flash",
  "persist",
  "status",
  "key",
  "store",
  "recode"
];

const DEVICE_ID = getDeviceId();

let suppressLocalEvents = false;
let syncRunning = false;
let syncTimer = null;
let currentUser = null;
let lastSyncError = false;

/* ==========================================
   DEVICE ID
========================================== */

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }

  return id;
}

function getDeviceName() {
  const ua = navigator.userAgent || "";

  if (/iPad/i.test(ua)) return "iPad";

  if (
    /iPhone/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  ) {
    return "iPhone";
  }

  if (/Android/i.test(ua)) return "Android";

  return "Компютър";
}

/* ==========================================
   INTERFACE
========================================== */

function createInterface() {
  const panel = document.createElement("section");

  panel.id = "cloudSyncPanel";
  panel.className = "panel open";

  panel.innerHTML = `
    <div class="section-title">
      CLOUD SYNC · M-GARAGE PRO 1.4
    </div>

    <div class="backup-info">
      Централизирано управление на данните
      между iPhone, iPad и компютър.
    </div>

    <div style="
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:10px;
      margin:14px 0;
    ">

      <div class="cloud-card">
        <div class="cloud-label">ИНТЕРНЕТ</div>
        <div id="dashboardNetwork" class="cloud-value">
          Проверка...
        </div>
      </div>

      <div class="cloud-card">
        <div class="cloud-label">CLOUD СТАТУС</div>
        <div id="dashboardCloud" class="cloud-value">
          Проверка...
        </div>
      </div>

      <div class="cloud-card">
        <div class="cloud-label">ПОСЛЕДНА СИНХРОНИЗАЦИЯ</div>
        <div id="dashboardLastSync" class="cloud-value small">
          Все още няма данни
        </div>
      </div>

      <div class="cloud-card">
        <div class="cloud-label">ЧАКАЩИ ПРОМЕНИ</div>
        <div id="dashboardPending" class="cloud-value">
          0
        </div>
      </div>
    </div>

    <div id="cloudUser" class="form-msg">
      Проверка на профила...
    </div>

    <div id="cloudAuthForm">
      <div class="panel-row">
        <input
          id="cloudEmail"
          type="email"
          placeholder="Имейл адрес"
          autocomplete="email"
        >

        <input
          id="cloudPassword"
          type="password"
          placeholder="Парола – минимум 6 символа"
          autocomplete="current-password"
        >
      </div>

      <div class="panel-row">
        <button class="btn-primary" id="cloudLogin" type="button">
          Вход
        </button>

        <button class="btn-secondary" id="cloudRegister" type="button">
          Регистрация
        </button>
      </div>
    </div>

    <div id="cloudActions" hidden>
      <div class="panel-row">
        <button class="btn-primary" id="cloudSync" type="button">
          ↻ Синхронизирай сега
        </button>

        <button class="btn-secondary" id="cloudLogout" type="button">
          Изход
        </button>
      </div>

      <div class="panel-row">
        <button class="btn-secondary" id="cloudRetry"
          type="button" style="width:100%">
          ⟳ Повтори синхронизацията
        </button>
      </div>
    </div>

    <div id="cloudStatus" class="form-msg">
      Данните се съхраняват локално.
    </div>

    <div class="cloud-section">

      <div class="section-title">
        УПРАВЛЕНИЕ НА УСТРОЙСТВАТА
      </div>

      <div class="backup-info">
        Устройства, които са използвали този Cloud профил
        за синхронизация.
      </div>

      <div class="device-summary" id="deviceSummary">
        Все още няма регистрирани устройства.
      </div>

      <button
        class="btn-secondary"
        id="cloudDevicesRefresh"
        type="button"
        style="width:100%;margin:10px 0"
      >
        ↻ Обнови устройствата
      </button>

      <div id="cloudDevicesStatus" class="form-msg">
        Списъкът ще се зареди след вход.
      </div>

      <div id="cloudDevicesList"></div>

    </div>

    <div class="cloud-section">

      <div class="section-title">
        ИСТОРИЯ НА СИНХРОНИЗАЦИИТЕ
      </div>

      <div class="backup-info">
        Централизирана история за всички устройства
        в твоя Cloud профил.
      </div>

      <button
        class="btn-secondary"
        id="cloudHistoryRefresh"
        type="button"
        style="width:100%;margin:10px 0"
      >
        ↻ Обнови историята
      </button>

      <div id="cloudHistoryStatus" class="form-msg">
        Историята ще се зареди след вход.
      </div>

      <div id="cloudHistoryList"></div>

    </div>

    <div class="backup-info">
      M-GARAGE PRO 1.4 · CLOUD DASHBOARD
    </div>
  `;

  const rules = document.querySelector(".rules");

  if (rules) {
    rules.after(panel);
  } else {
    const layout = document.querySelector(".layout");

    if (layout) layout.prepend(panel);
  }

  const style = document.createElement("style");

  style.textContent = `
    .cloud-card {
      background:var(--card,rgba(128,128,128,.10));
      border:1px solid var(--border,rgba(128,128,128,.2));
      border-radius:12px;
      padding:12px;
      min-width:0;
    }

    .cloud-label {
      font-size:11px;
      opacity:.7;
      margin-bottom:7px;
    }

    .cloud-value {
      font-weight:700;
      font-size:14px;
      overflow-wrap:anywhere;
    }

    .cloud-value.small {
      font-size:12px;
      line-height:1.5;
    }

    .cloud-section {
      border-top:1px solid var(--border,rgba(128,128,128,.2));
      margin-top:18px;
      padding-top:16px;
    }

    .device-summary {
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:8px;
      margin:12px 0;
    }

    .device-stat {
      background:var(--card,rgba(128,128,128,.08));
      border:1px solid var(--border,rgba(128,128,128,.2));
      border-radius:10px;
      padding:11px;
    }

    .device-stat-label {
      font-size:11px;
      opacity:.7;
      margin-bottom:5px;
    }

    .device-stat-value {
      font-size:18px;
      font-weight:700;
    }

    .device-item {
      border:1px solid var(--border,rgba(128,128,128,.2));
      background:var(--card,rgba(128,128,128,.06));
      border-radius:12px;
      padding:13px;
      margin:9px 0;
    }

    .device-heading {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:8px;
      font-weight:700;
      font-size:14px;
    }

    .device-current {
      color:#16a34a;
      font-size:11px;
      font-weight:700;
      white-space:nowrap;
    }

    .device-meta {
      opacity:.7;
      font-size:12px;
      line-height:1.7;
      margin-top:8px;
      overflow-wrap:anywhere;
    }

    .history-item {
      border:1px solid var(--border,rgba(128,128,128,.2));
      background:var(--card,rgba(128,128,128,.06));
      border-radius:12px;
      padding:12px;
      margin:9px 0;
    }

    .history-heading {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:8px;
      font-weight:700;
      font-size:13px;
    }

    .history-meta {
      opacity:.7;
      font-size:12px;
      line-height:1.6;
      margin-top:7px;
      overflow-wrap:anywhere;
    }

    .history-success {
      color:#16a34a;
    }

    .history-error {
      color:#dc2626;
    }
  `;

  document.head.appendChild(style);

  return panel;
}

createInterface();

const $ = (id) => document.getElementById(id);

/* ==========================================
   DASHBOARD
========================================== */

function setIndicator(id, message, color) {
  const element = $(id);

  if (!element) return;

  element.textContent = message;
  element.style.color = color || "inherit";
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Невалидна дата";
  }

  return date.toLocaleDateString("bg-BG") +
    " · " +
    date.toLocaleTimeString("bg-BG", {
      hour: "2-digit",
      minute: "2-digit"
    });
}

function getLastSyncText() {
  const value = localStorage.getItem(LAST_SYNC_KEY);

  return value ? formatDate(value) : "Все още няма данни";
}

function refreshDashboard() {
  const online = navigator.onLine;

  setIndicator(
    "dashboardNetwork",
    online ? "● ONLINE" : "● OFFLINE",
    online ? "#16a34a" : "#dc2626"
  );

  const pending = readPending().length;

  setIndicator(
    "dashboardPending",
    String(pending),
    pending > 0 ? "#d97706" : "#16a34a"
  );

  setIndicator(
    "dashboardLastSync",
    getLastSyncText(),
    "inherit"
  );

  let message = "Не е влязъл";
  let color = "#d97706";

  if (syncRunning) {
    message = "Синхронизира...";
    color = "#2563eb";
  } else if (lastSyncError) {
    message = "Има проблем";
    color = "#dc2626";
  } else if (currentUser && !online) {
    message = "Изчаква интернет";
    color = "#d97706";
  } else if (currentUser && pending > 0) {
    message = "Чакащи промени";
    color = "#d97706";
  } else if (currentUser && localStorage.getItem(LAST_SYNC_KEY)) {
    message = "Синхронизиран";
    color = "#16a34a";
  } else if (currentUser) {
    message = "Очаква синхронизация";
    color = "#2563eb";
  }

  setIndicator(
    "dashboardCloud",
    "● " + message,
    color
  );
}

/* ==========================================
   STATUS
========================================== */

function status(message, type = "") {
  const element = $("cloudStatus");

  if (element) {
    element.textContent = message;
    element.className = "form-msg" + (type ? " " + type : "");
  }

  refreshDashboard();
}

function userStatus(message, type = "") {
  const element = $("cloudUser");

  if (element) {
    element.textContent = message;
    element.className = "form-msg" + (type ? " " + type : "");
  }

  refreshDashboard();
}

function setHistoryStatus(message) {
  const element = $("cloudHistoryStatus");

  if (element) element.textContent = message;
}

function setDevicesStatus(message) {
  const element = $("cloudDevicesStatus");

  if (element) element.textContent = message;
}

function setBusy(busy) {
  [
    "cloudLogin",
    "cloudRegister",
    "cloudSync",
    "cloudLogout",
    "cloudRetry",
    "cloudHistoryRefresh",
    "cloudDevicesRefresh"
  ].forEach(id => {
    const button = $(id);

    if (button) button.disabled = busy;
  });

  refreshDashboard();
}

/* ==========================================
   LOCAL DATA
========================================== */

function cleanCars(input) {
  if (!Array.isArray(input)) return [];

  const result = [];
  const seen = new Set();

  input.forEach(item => {
    if (!item || typeof item !== "object") return;

    const vin = String(item.vin || "")
      .trim()
      .toUpperCase();

    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return;
    if (seen.has(vin)) return;

    seen.add(vin);

    const done = {};

    STEP_IDS.forEach(id => {
      if (item.done && item.done[id] === true) {
        done[id] = true;
      }
    });

    result.push({
      vin,
      nick: String(item.nick || "BMW")
        .trim()
        .slice(0, 30) || "BMW",
      done
    });
  });

  return result;
}

function readLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return {
      cars: cleanCars(parsed),
      activeVin: localStorage.getItem(ACTIVE_KEY) || ""
    };
  } catch (error) {
    throw new Error("Не могат да бъдат прочетени локалните данни.");
  }
}

function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function savePending(events) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(events));
  refreshDashboard();
}

function createEvent(entityType, entityId, operation, data) {
  return {
    event_id: crypto.randomUUID(),
    device_id: DEVICE_ID,
    entity_type: entityType,
    entity_id: entityId,
    operation,
    data
  };
}

function enqueueEvents(events) {
  if (!events.length) return;

  const pending = readPending();

  pending.push(...events);

  savePending(pending);
  scheduleAutomaticSync();
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

    if (!oldCar) {
      events.push(
        createEvent("car", vin, "upsert", {
          nick: newCar.nick
        })
      );

      STEP_IDS.forEach(id => {
        if (newCar.done[id] === true) {
          events.push(
            createEvent("step", vin + ":" + id, "set", {
              done: true
            })
          );
        }
      });

      return;
    }

    if (oldCar.nick !== newCar.nick) {
      events.push(
        createEvent("car", vin, "upsert", {
          nick: newCar.nick
        })
      );
    }

    STEP_IDS.forEach(id => {
      const oldDone = oldCar.done[id] === true;
      const newDone = newCar.done[id] === true;

      if (oldDone !== newDone) {
        events.push(
          createEvent("step", vin + ":" + id, "set", {
            done: newDone
          })
        );
      }
    });
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
    } catch (error) {
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
        createEvent("active", "active", "set", {
          vin: newVin
        })
      ]);
    }

    return result;
  }

  return originalSetItem.call(this, key, value);
};

/* ==========================================
   SAVE LOCAL DATA
========================================== */

function saveLocalData(data) {
  try {
    suppressLocalEvents = true;

    originalSetItem.call(
      localStorage,
      STORAGE_KEY,
      JSON.stringify(data.cars)
    );

    originalSetItem.call(
      localStorage,
      ACTIVE_KEY,
      data.activeVin || ""
    );
  } catch (error) {
    throw new Error("Неуспешно запазване на локалните данни.");
  } finally {
    suppressLocalEvents = false;
  }
}

/* ==========================================
   AUTHENTICATION
========================================== */

function showAuthenticated(user) {
  currentUser = user;

  $("cloudAuthForm").hidden = true;
  $("cloudActions").hidden = false;

  userStatus("Влязъл потребител: " + user.email, "ok");

  status("Cloud Sync е активен.");

  loadHistory();
  loadDevices();
}

function showLoggedOut() {
  currentUser = null;

  $("cloudAuthForm").hidden = false;
  $("cloudActions").hidden = true;

  userStatus("Не си влязъл в Cloud Sync.");

  setHistoryStatus("Влез в профила си, за да видиш историята.");
  setDevicesStatus("Влез в профила си, за да видиш устройствата.");

  $("cloudHistoryList").replaceChildren();
  $("cloudDevicesList").replaceChildren();
  $("deviceSummary").textContent =
    "Все още няма регистрирани устройства.";

  status("Локалните данни са налични.");
}

async function register() {
  const email = $("cloudEmail").value.trim();
  const password = $("cloudPassword").value;

  if (!email || password.length < 6) {
    status("Въведи валиден имейл и парола от минимум 6 символа.");
    return;
  }

  setBusy(true);

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    if (data.session) {
      showAuthenticated(data.user);
      status("Регистрацията е успешна.", "ok");
      scheduleAutomaticSync(1000);
    } else {
      status("Регистрацията е приета. Провери имейла си и потвърди регистрацията.");
    }
  } catch (error) {
    status("Грешка при регистрация: " + error.message);
  } finally {
    setBusy(false);
  }
}

async function login() {
  const email = $("cloudEmail").value.trim();
  const password = $("cloudPassword").value;

  if (!email || !password) {
    status("Въведи имейл и парола.");
    return;
  }

  setBusy(true);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    showAuthenticated(data.user);
    status("Входът е успешен.", "ok");

    scheduleAutomaticSync(1000);
  } catch (error) {
    status("Грешка при вход: " + error.message);
  } finally {
    setBusy(false);
  }
}

async function logout() {
  setBusy(true);

  try {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    showLoggedOut();
    status("Излезе от Cloud Sync.", "ok");
  } catch (error) {
    status("Грешка при изход: " + error.message);
  } finally {
    setBusy(false);
  }
}

/* ==========================================
   CLOUD EVENT FETCH
========================================== */

async function fetchAllEvents(userId) {
  const allEvents = [];
  const pageSize = 1000;

  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("user_changes")
      .select(
        "event_id, event_order, device_id, entity_type, entity_id, operation, data, created_at"
      )
      .eq("user_id", userId)
      .order("event_order", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    if (data && data.length) {
      allEvents.push(...data);
    }

    if (!data || data.length < pageSize) break;

    offset += pageSize;
  }

  return allEvents;
}

/* ==========================================
   LEGACY DATA
========================================== */

async function readLegacyData(userId) {
  const { data, error } = await supabase
    .from("user_data")
    .select("payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return data && data.payload ? data.payload : {};
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

  const initialEvents = [];

  combined.forEach(car => {
    if (knownCars.has(car.vin)) return;

    initialEvents.push(
      createEvent("car", car.vin, "upsert", {
        nick: car.nick
      })
    );

    STEP_IDS.forEach(id => {
      if (car.done[id] === true) {
        initialEvents.push(
          createEvent("step", car.vin + ":" + id, "set", {
            done: true
          })
        );
      }
    });
  });

  const hasActiveEvent = events.some(
    event => event.entity_type === "active"
  );

  if (!hasActiveEvent) {
    const activeVin = local.activeVin || legacy.activeVin || "";

    initialEvents.push(
      createEvent("active", "active", "set", {
        vin: activeVin
      })
    );
  }

  return initialEvents;
}

/* ==========================================
   UPLOAD EVENTS
========================================== */

async function uploadEvents(userId, events) {
  if (!events.length) return;

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

  const sendingIds = new Set(
    pending.map(event => event.event_id)
  );

  await uploadEvents(userId, pending);

  const remaining = readPending().filter(
    event => !sendingIds.has(event.event_id)
  );

  savePending(remaining);

  return pending.length;
}

/* ==========================================
   APPLY CLOUD EVENTS
========================================== */

function applyEvents(events) {
  const cars = new Map();
  let activeVin = "";

  events.forEach(event => {
    const type = event.entity_type;
    const id = event.entity_id;
    const data = event.data || {};

    if (type === "car") {
      if (event.operation === "delete") {
        cars.delete(id);
        return;
      }

      if (event.operation === "upsert") {
        const existing = cars.get(id);

        cars.set(id, {
          vin: id,
          nick: String(data.nick || existing?.nick || "BMW")
            .trim()
            .slice(0, 30) || "BMW",
          done: existing ? { ...existing.done } : {}
        });
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
      activeVin = String(data.vin || "");
    }
  });

  const resultCars = Array.from(cars.values());

  if (!resultCars.some(car => car.vin === activeVin)) {
    activeVin = resultCars[0]?.vin || "";
  }

  return {
    cars: resultCars,
    activeVin
  };
}

/* ==========================================
   CLOUD SYNC HISTORY
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
        ? String(errorMessage).slice(0, 500)
        : null
    });

  if (error) throw error;
}

function renderHistory(items) {
  const container = $("cloudHistoryList");

  if (!container) return;

  container.replaceChildren();

  if (!items.length) {
    setHistoryStatus("Все още няма записи в историята.");
    return;
  }

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "history-item";

    const heading = document.createElement("div");
    heading.className = "history-heading";

    const result = document.createElement("span");
    result.className =
      item.result === "success"
        ? "history-success"
        : "history-error";

    result.textContent =
      item.result === "success"
        ? "✓ Успешна синхронизация"
        : "✕ Неуспешна синхронизация";

    const device = document.createElement("span");
    device.textContent =
      item.device_name ||
      (item.device_id === DEVICE_ID
        ? getDeviceName()
        : "Стар запис");

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

  setHistoryStatus("Показани са последните " + items.length + " записа.");
}

async function loadHistory() {
  if (!currentUser) {
    setHistoryStatus("Влез в профила си, за да видиш историята.");
    return;
  }

  setHistoryStatus("Зареждане на историята...");

  try {
    const { data, error } = await supabase
      .from("sync_history")
      .select(
        "id, device_id, device_name, result, cars_count, changes_count, error_message, created_at"
      )
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(30);

    if (error) throw error;

    renderHistory(data || []);
  } catch (error) {
    console.error("M-GARAGE HISTORY:", error);

    setHistoryStatus(
      "Историята не може да бъде заредена: " + error.message
    );
  }
}

/* ==========================================
   DEVICE MANAGEMENT
========================================== */

function renderDeviceSummary(devices) {
  const container = $("deviceSummary");

  if (!container) return;

  container.replaceChildren();

  const total = devices.length;

  const active = devices.filter(device =>
    device.device_id === DEVICE_ID
  ).length;

  const successful = devices.reduce(
    (sum, device) => sum + device.successCount,
    0
  );

  const failed = devices.reduce(
    (sum, device) => sum + device.errorCount,
    0
  );

  const stats = [
    ["УСТРОЙСТВА", total],
    ["ТЕКУЩО УСТРОЙСТВО", active],
    ["УСПЕШНИ СИНХРОНИЗАЦИИ", successful],
    ["НЕУСПЕШНИ СИНХРОНИЗАЦИИ", failed]
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
    container.append(card);
  });
}

function renderDevices(items) {
  const container = $("cloudDevicesList");

  if (!container) return;

  container.replaceChildren();

  const deviceMap = new Map();

  items.forEach(item => {
    if (!item.device_id) return;

    let device = deviceMap.get(item.device_id);

    if (!device) {
      device = {
        device_id: item.device_id,
        device_name: item.device_name || "Старо устройство",
        lastSeen: item.created_at,
        lastResult: item.result,
        totalCount: 0,
        successCount: 0,
        errorCount: 0
      };

      deviceMap.set(item.device_id, device);
    }

    device.totalCount++;

    if (item.result === "success") {
      device.successCount++;
    } else if (item.result === "error") {
      device.errorCount++;
    }

    if (
      new Date(item.created_at).getTime() >
      new Date(device.lastSeen).getTime()
    ) {
      device.lastSeen = item.created_at;
      device.lastResult = item.result;

      if (item.device_name) {
        device.device_name = item.device_name;
      }
    }
  });

  const devices = Array.from(deviceMap.values()).sort(
    (a, b) =>
      new Date(b.lastSeen).getTime() -
      new Date(a.lastSeen).getTime()
  );

  renderDeviceSummary(devices);

  if (!devices.length) {
    container.textContent =
      "Все още няма регистрирани устройства.";
    setDevicesStatus("Няма намерени записи.");
    return;
  }

  devices.forEach(device => {
    const card = document.createElement("div");
    card.className = "device-item";

    const heading = document.createElement("div");
    heading.className = "device-heading";

    const name = document.createElement("span");
    name.textContent = device.device_name;

    const current = document.createElement("span");

    if (device.device_id === DEVICE_ID) {
      current.className = "device-current";
      current.textContent = "ТЕКУЩО";
    } else {
      current.textContent = "";
    }

    heading.append(name, current);

    const meta = document.createElement("div");
    meta.className = "device-meta";

    const statusText =
      device.lastResult === "success"
        ? "✓ Успешна"
        : "✕ Неуспешна";

    meta.textContent =
      "Последна активност: " + formatDate(device.lastSeen) +
      "\nПоследен резултат: " + statusText +
      "\nОбщо синхронизации: " + device.totalCount +
      "\nУспешни: " + device.successCount +
      " · Неуспешни: " + device.errorCount +
      "\nID: " + device.device_id;

    card.append(heading, meta);
    container.append(card);
  });

  setDevicesStatus(
    "Намерени устройства: " + devices.length +
    ". Данните са обобщени от записите в историята."
  );
}

async function loadDevices() {
  if (!currentUser) {
    setDevicesStatus("Влез в профила си, за да видиш устройствата.");
    return;
  }

  setDevicesStatus("Зареждане на устройствата...");

  try {
    const allItems = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from("sync_history")
        .select(
          "id, device_id, device_name, result, created_at"
        )
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;

      if (data && data.length) {
        allItems.push(...data);
      }

      if (!data || data.length < pageSize) break;

      offset += pageSize;
    }

    renderDevices(allItems);

  } catch (error) {
    console.error("M-GARAGE DEVICES:", error);

    setDevicesStatus(
      "Устройствата не могат да бъдат заредени: " +
      error.message
    );
  }
}

/* ==========================================
   MAIN SYNC
========================================== */

async function syncNow() {
  if (syncRunning) return;

  if (!navigator.onLine) {
    lastSyncError = true;

    status(
      "Няма интернет. Промените са запазени локално и чакат синхронизация."
    );

    return;
  }

  syncRunning = true;
  lastSyncError = false;

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

    const local = readLocalData();

    let cloudEvents = await fetchAllEvents(userId);

    const legacy = await readLegacyData(userId);

    const initialEvents = createInitialEvents(
      cloudEvents,
      local,
      legacy
    );

    if (initialEvents.length) {
      await uploadEvents(userId, initialEvents);
      processedChanges += initialEvents.length;
    }

    processedChanges += await uploadPending(userId);

    cloudEvents = await fetchAllEvents(userId);

    const merged = applyEvents(cloudEvents);

    mergedCarsCount = merged.cars.length;

    saveLocalData(merged);

    if (typeof window.renderAll === "function") {
      window.renderAll();
    } else {
      window.location.reload();
      return;
    }

    const now = new Date();

    localStorage.setItem(
      LAST_SYNC_KEY,
      now.toISOString()
    );

    lastSyncError = false;

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

    if (historyUserId) {
      try {
        await writeHistory(
          historyUserId,
          "error",
          mergedCarsCount,
          processedChanges,
          error.message
        );

        await loadHistory();
        await loadDevices();

      } catch (historyError) {
        console.error(
          "M-GARAGE HISTORY ERROR:",
          historyError
        );
      }
    }

    status("Грешка при синхронизация: " + error.message);

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

      if (session) await syncNow();

    } catch (error) {
      console.error("M-GARAGE AUTO SYNC:", error);

      lastSyncError = true;
      refreshDashboard();
    }
  }, delay);
}

/* ==========================================
   NETWORK EVENTS
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

/* ==========================================
   PAGE VISIBILITY
========================================== */

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && navigator.onLine) {
    scheduleAutomaticSync(1000);
  }

  refreshDashboard();
});

/* ==========================================
   EVENTS
========================================== */

$("cloudLogin").addEventListener("click", login);
$("cloudRegister").addEventListener("click", register);
$("cloudLogout").addEventListener("click", logout);
$("cloudSync").addEventListener("click", syncNow);
$("cloudRetry").addEventListener("click", syncNow);
$("cloudHistoryRefresh").addEventListener("click", loadHistory);
$("cloudDevicesRefresh").addEventListener("click", loadDevices);

/* ==========================================
   AUTH STATE
========================================== */

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    showAuthenticated(session.user);

    if (
      event === "SIGNED_IN" ||
      event === "INITIAL_SESSION" ||
      event === "TOKEN_REFRESHED"
    ) {
      scheduleAutomaticSync(1200);
    }
  } else {
    showLoggedOut();
  }

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
      scheduleAutomaticSync(1500);
    } else {
      showLoggedOut();
    }
  } catch (error) {
    lastSyncError = true;

    userStatus("Cloud Sync не е достъпен.");
    status(error.message);
  }

  refreshDashboard();
}

initializeCloud();
