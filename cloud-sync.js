
"use strict";

/* ==========================================
   M-GARAGE PRO
   CLOUD SYNC MODULE
   Version: 1.1
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
      CLOUD SYNC · M-GARAGE PRO 1.1
    </div>

    <div class="backup-info">
      Автоматична синхронизация между
      iPhone, iPad и компютър.
      Промените се запазват и при липса
      на интернет.
    </div>

    <div id="cloudUser" class="form-msg">
      Проверка на връзката...
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
    </div>

    <div id="cloudStatus" class="form-msg">
      Данните се съхраняват локално.
    </div>

    <div class="backup-info">
      Cloud Sync 1.1 · Автоматично записване
      на добавени, редактирани и изтрити
      автомобили и промени по прогреса.
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

function status(message, type = "") {
  const element = $("cloudStatus");

  if (!element) return;

  element.textContent = message;
  element.className = "form-msg" + (type ? " " + type : "");
}

function userStatus(message, type = "") {
  const element = $("cloudUser");

  if (!element) return;

  element.textContent = message;
  element.className = "form-msg" + (type ? " " + type : "");
}

function setBusy(busy) {
  [
    "cloudLogin",
    "cloudRegister",
    "cloudSync",
    "cloudLogout"
  ].forEach(id => {
    const button = $(id);

    if (button) {
      button.disabled = busy;
    }
  });
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
      scheduleAutomaticSync();
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

      scheduleAutomaticSync();
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
  $("cloudAuthForm").hidden = true;
  $("cloudActions").hidden = false;

  userStatus(
    "Влязъл потребител: " + user.email,
    "ok"
  );

  status("Cloud Sync е активен.");
}

function showLoggedOut() {
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
    status(
      "Няма интернет. Промените са запазени локално и чакат синхронизация."
    );
    return;
  }

  syncRunning = true;
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

    // 1. Прочитаме локалните данни.
    const local = readLocalData();

    // 2. Прочитаме историята на облачните промени.
    let cloudEvents = await fetchAllEvents(userId);

    // 3. Прочитаме стария облачен формат.
    const legacy = await readLegacyData(userId);

    // 4. Прехвърляме липсващите стари записи.
    const initialEvents = createInitialEvents(
      cloudEvents,
      local,
      legacy
    );

    if (initialEvents.length) {
      await uploadEvents(userId, initialEvents);
    }

    // 5. Изпращаме локалните чакащи промени.
    await uploadPending(userId);

    // 6. Изтегляме актуалната история.
    cloudEvents = await fetchAllEvents(userId);

    // 7. Прилагаме всички събития в реда им.
    const merged = applyEvents(cloudEvents);

    // 8. Записваме резултата локално.
    saveLocalData(merged);

    // 9. Обновяваме визуализацията.
    if (typeof window.renderAll === "function") {
      window.renderAll();
    } else {
      window.location.reload();
      return;
    }

    const now = new Date();

    localStorage.setItem(
      "mgu_cloud_last_sync",
      now.toISOString()
    );

    status(
      "Синхронизацията е успешна. Автомобили: " +
      merged.cars.length +
      ". Последна синхронизация: " +
      now.toLocaleString("bg-BG"),
      "ok"
    );

  } catch (error) {
    console.error("M-GARAGE CLOUD SYNC:", error);

    status(
      "Грешка при синхронизация: " + error.message
    );

  } finally {
    syncRunning = false;
    setBusy(false);
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
    if (!navigator.onLine) return;

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
    }
  }, delay);
}

window.addEventListener("online", () => {
  status("Интернет връзката е възстановена. Синхронизация...");

  scheduleAutomaticSync(500);
});

/* ==========================================
   EVENTS
========================================== */

$("cloudLogin").addEventListener("click", login);
$("cloudRegister").addEventListener("click", register);
$("cloudLogout").addEventListener("click", logout);
$("cloudSync").addEventListener("click", syncNow);

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
});

/* ==========================================
   INITIALIZATION
========================================== */

async function initializeCloud() {
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
    userStatus("Cloud Sync не е достъпен.");
    status(error.message);
  }
}

initializeCloud();
