
"use strict";

/* ==========================================
   M-GARAGE PRO
   CLOUD SYNC MODULE
   Version: 1.2
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

/* ==========================================
   INTERFACE
========================================== */

function createInterface() {
  const panel = document.createElement("section");

  panel.id = "cloudSyncPanel";
  panel.className = "panel open";

  panel.innerHTML = `
    <div class="section-title">
      CLOUD SYNC · M-GARAGE PRO 1.2
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

      <div style="
        background:var(--card,rgba(128,128,128,.10));
        border:1px solid var(--border,rgba(128,128,128,.2));
        border-radius:12px;
        padding:12px;
      ">
        <div style="font-size:11px;opacity:.7;margin-bottom:7px">
          ИНТЕРНЕТ
        </div>
        <div id="dashboardNetwork"
          style="font-weight:700;font-size:14px">
          Проверка...
        </div>
      </div>

      <div style="
        background:var(--card,rgba(128,128,128,.10));
        border:1px solid var(--border,rgba(128,128,128,.2));
        border-radius:12px;
        padding:12px;
      ">
        <div style="font-size:11px;opacity:.7;margin-bottom:7px">
          CLOUD СТАТУС
        </div>
        <div id="dashboardCloud"
          style="font-weight:700;font-size:14px">
          Проверка...
        </div>
      </div>

      <div style="
        background:var(--card,rgba(128,128,128,.10));
        border:1px solid var(--border,rgba(128,128,128,.2));
        border-radius:12px;
        padding:12px;
      ">
        <div style="font-size:11px;opacity:.7;margin-bottom:7px">
          ПОСЛЕДНА СИНХРОНИЗАЦИЯ
        </div>
        <div id="dashboardLastSync"
          style="font-weight:700;font-size:12px;line-height:1.5">
          Все още няма данни
        </div>
      </div>

      <div style="
        background:var(--card,rgba(128,128,128,.10));
        border:1px solid var(--border,rgba(128,128,128,.2));
        border-radius:12px;
        padding:12px;
      ">
        <div style="font-size:11px;opacity:.7;margin-bottom:7px">
          ЧАКАЩИ ПРОМЕНИ
        </div>
        <div id="dashboardPending"
          style="font-weight:700;font-size:14px">
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
        <button
          class="btn-primary"
          id="cloudLogin"
          type="button"
        >
          Вход
        </button>

        <button
          class="btn-secondary"
          id="cloudRegister"
          type="button"
        >
          Регистрация
        </button>
      </div>
    </div>

    <div id="cloudActions" hidden>
      <div class="panel-row">
        <button
          class="btn-primary"
          id="cloudSync"
          type="button"
        >
          ↻ Синхронизирай сега
        </button>

        <button
          class="btn-secondary"
          id="cloudLogout"
          type="button"
        >
          Изход
        </button>
      </div>

      <div class="panel-row">
        <button
          class="btn-secondary"
          id="cloudRetry"
          type="button"
          style="width:100%"
        >
          ⟳ Повтори синхронизацията
        </button>
      </div>
    </div>

    <div id="cloudStatus" class="form-msg">
      Данните се съхраняват локално.
    </div>

    <div class="backup-info">
      M-GARAGE PRO 1.2 · CLOUD DASHBOARD
    </div>
  `;

  const rules = document.querySelector(".rules");

  if (rules) {
    rules.after(panel);
  } else {
    const layout = document.querySelector(".layout");

    if (layout) {
      layout.prepend(panel);
    }
  }

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

function getLastSyncText() {
  const value = localStorage.getItem(LAST_SYNC_KEY);

  if (!value) {
    return "Все още няма данни";
  }

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

  let cloudMessage = "Не е влязъл";
  let cloudColor = "#d97706";

  if (syncRunning) {
    cloudMessage = "Синхронизира...";
    cloudColor = "#2563eb";

  } else if (lastSyncError) {
    cloudMessage = "Има проблем";
    cloudColor = "#dc2626";

  } else if (currentUser && !online) {
    cloudMessage = "Изчаква интернет";
    cloudColor = "#d97706";

  } else if (currentUser && pending > 0) {
    cloudMessage = "Чакащи промени";
    cloudColor = "#d97706";

  } else if (currentUser && localStorage.getItem(LAST_SYNC_KEY)) {
    cloudMessage = "Синхронизиран";
    cloudColor = "#16a34a";

  } else if (currentUser) {
    cloudMessage = "Очаква синхронизация";
    cloudColor = "#2563eb";
  }

  setIndicator(
    "dashboardCloud",
    "● " + cloudMessage,
    cloudColor
  );
}

/* ==========================================
   STATUS MESSAGES
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

function setBusy(busy) {
  [
    "cloudLogin",
    "cloudRegister",
    "cloudSync",
    "cloudLogout",
    "cloudRetry"
  ].forEach(id => {
    const button = $(id);

    if (button) {
      button.disabled = busy;
    }
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
    const rawCars = localStorage.getItem(STORAGE_KEY);
    const parsedCars = rawCars ? JSON.parse(rawCars) : [];

    return {
      cars: cleanCars(parsedCars),
      activeVin: localStorage.getItem(ACTIVE_KEY) || ""
    };

  } catch (error) {
    throw new Error(
      "Не могат да бъдат прочетени локалните данни."
    );
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
  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify(events)
  );

  refreshDashboard();
}

function createEvent(
  entityType,
  entityId,
  operation,
  data
) {
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

  const oldMap = new Map(
    oldCars.map(car => [car.vin, car])
  );

  const newMap = new Map(
    newCars.map(car => [car.vin, car])
  );

  const events = [];

  oldMap.forEach((oldCar, vin) => {
    if (!newMap.has(vin)) {
      events.push(
        createEvent("car", vin, "delete", {})
      );
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
            createEvent(
              "step",
              vin + ":" + id,
              "set",
              { done: true }
            )
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
          createEvent(
            "step",
            vin + ":" + id,
            "set",
            { done: newDone }
          )
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
  if (
    this !== localStorage ||
    suppressLocalEvents
  ) {
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
      const newCars = JSON.parse(value);
      enqueueEvents(compareCars(oldCars, newCars));
    } catch (error) {
      console.error("Cloud change detection:", error);
    }

    return result;
  }

  if (key === ACTIVE_KEY) {
    const oldVin =
      originalGetItem.call(this, key) || "";

    const result = originalSetItem.call(this, key, value);

    const newVin = String(value || "");

    if (oldVin !== newVin) {
      enqueueEvents([
        createEvent(
          "active",
          "active",
          "set",
          { vin: newVin }
        )
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
    throw new Error(
      "Неуспешно запазване на локалните данни."
    );

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

  userStatus(
    "Влязъл потребител: " + user.email,
    "ok"
  );

  status("Cloud Sync е активен.");
}

function showLoggedOut() {
  currentUser = null;

  $("cloudAuthForm").hidden = false;
  $("cloudActions").hidden = true;

  userStatus("Не си влязъл в Cloud Sync.");

  status("Локалните данни са налични.");
}

async function register() {
  const email = $("cloudEmail").value.trim();
  const password = $("cloudPassword").value;

  if (!email || password.length < 6) {
    status(
      "Въведи валиден имейл и парола от минимум 6 символа."
    );
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
      status(
        "Регистрацията е приета. Провери имейла си и потвърди регистрацията."
      );
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
    const { data, error } =
      await supabase.auth.signInWithPassword({
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
   FETCH CLOUD EVENTS
========================================== */

async function fetchAllEvents(userId) {
  const allEvents = [];
  const pageSize = 1000;

  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("user_changes")
      .select(
        "event_id, device_id, entity_type, entity_id, operation, data, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("event_id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    if (data && data.length) {
      allEvents.push(...data);
    }

    if (!data || data.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return allEvents;
}

/* ==========================================
   LEGACY DATA MIGRATION
========================================== */

async function readLegacyData(userId) {
  const { data, error } = await supabase
    .from("user_data")
    .select("payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return data && data.payload
    ? data.payload
    : {};
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
          createEvent(
            "step",
            car.vin + ":" + id,
            "set",
            { done: true }
          )
        );
      }
    });
  });

  const hasActiveEvent = events.some(
    event => event.entity_type === "active"
  );

  if (!hasActiveEvent) {
    const activeVin =
      local.activeVin ||
      legacy.activeVin ||
      "";

    initialEvents.push(
      createEvent(
        "active",
        "active",
        "set",
        { vin: activeVin }
      )
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

  if (!pending.length) return;

  const sendingIds = new Set(
    pending.map(event => event.event_id)
  );

  await uploadEvents(userId, pending);

  const remaining = readPending().filter(
    event => !sendingIds.has(event.event_id)
  );

  savePending(remaining);
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

  try {
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;
    if (!session) throw new Error("Не си влязъл в профила.");

    const userId = session.user.id;

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
    }

    await uploadPending(userId);

    cloudEvents = await fetchAllEvents(userId);

    const merged = applyEvents(cloudEvents);

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

    status(
      "Синхронизацията е успешна. Автомобили: " +
      merged.cars.length +
      ". Последна синхронизация: " +
      now.toLocaleString("bg-BG"),
      "ok"
    );

  } catch (error) {
    console.error("M-GARAGE CLOUD SYNC:", error);

    lastSyncError = true;

    status(
      "Грешка при синхронизация: " + error.message
    );

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
  if (syncTimer) {
    clearTimeout(syncTimer);
  }

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
        await syncNow();
      }

    } catch (error) {
      console.error(
        "M-GARAGE AUTO SYNC:",
        error
      );

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

  status(
    "Интернетът е възстановен. Започва синхронизация..."
  );

  scheduleAutomaticSync(500);
});

window.addEventListener("offline", () => {
  status(
    "Няма интернет. Локалните промени се запазват."
  );

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
