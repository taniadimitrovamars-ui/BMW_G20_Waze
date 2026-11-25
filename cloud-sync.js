
"use strict";

/* ==========================================
   M-GARAGE PRO
   CLOUD SYNC MODULE
   Version: 1.0
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

/* ==========================================
   INTERFACE
========================================== */

function createInterface() {
  const panel = document.createElement("section");

  panel.id = "cloudSyncPanel";
  panel.className = "panel open";

  panel.innerHTML = `
    <div class="section-title">
      CLOUD SYNC · M-GARAGE PRO
    </div>

    <div class="backup-info">
      Синхронизирай автомобилите и прогреса
      между iPhone, iPad и компютър.
      Локалните данни остават запазени.
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
      Важно: направи Backup преди първата
      синхронизация. При синхронизация
      автомобилите се обединяват по VIN.
      Завършените стъпки не се губят.
    </div>
  `;

  const rules = document.querySelector(".rules");

  if (rules) {
    rules.after(panel);
  } else {
    document.querySelector(".layout").prepend(panel);
  }

  return panel;
}

const panel = createInterface();

const $ = (id) => document.getElementById(id);

function status(message, type = "") {
  const element = $("cloudStatus");

  element.textContent = message;
  element.className = "form-msg" + (type ? " " + type : "");
}

function userStatus(message, type = "") {
  const element = $("cloudUser");

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
    if (button) button.disabled = busy;
  });
}

/* ==========================================
   LOCAL DATA
========================================== */

function readLocalData() {
  let cars = [];
  let activeVin = "";

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      cars = parsed;
    }

    activeVin = localStorage.getItem(ACTIVE_KEY) || "";

  } catch (error) {
    throw new Error("Не могат да бъдат прочетени локалните данни.");
  }

  return {
    cars: cleanCars(cars),
    activeVin
  };
}

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

/* ==========================================
   SAFE MERGE
========================================== */

function mergeCars(localCars, cloudCars) {
  const merged = new Map();

  localCars.forEach(car => {
    merged.set(car.vin, {
      vin: car.vin,
      nick: car.nick,
      done: { ...car.done }
    });
  });

  cloudCars.forEach(car => {
    if (!merged.has(car.vin)) {
      merged.set(car.vin, {
        vin: car.vin,
        nick: car.nick,
        done: { ...car.done }
      });

      return;
    }

    const existing = merged.get(car.vin);

    STEP_IDS.forEach(id => {
      existing.done[id] =
        existing.done[id] === true ||
        car.done[id] === true;
    });

    // Запазваме локалното име,
    // ако вече съществува такъв VIN.
  });

  return Array.from(merged.values());
}

function saveLocalData(data) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(data.cars)
    );

    localStorage.setItem(
      ACTIVE_KEY,
      data.activeVin || ""
    );

  } catch (error) {
    throw new Error("Неуспешно запазване на локалните данни.");
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

  status("Готово за синхронизация.");
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
   CLOUD SYNC
========================================== */

async function syncNow() {
  if (!navigator.onLine) {
    status("Няма интернет връзка. Данните остават локални.");
    return;
  }

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

    // 2. Изтегляме облачните данни.
    const { data: cloud, error: readError } =
      await supabase
        .from("user_data")
        .select("payload, updated_at")
        .eq("user_id", userId)
        .maybeSingle();

    if (readError) throw readError;

    const cloudPayload =
      cloud && cloud.payload
        ? cloud.payload
        : {};

    const cloudCars = cleanCars(
      cloudPayload.cars || []
    );

    // 3. Обединяваме автомобилите по VIN.
    const mergedCars = mergeCars(
      local.cars,
      cloudCars
    );

    const requestedActive =
      local.cars.some(c => c.vin === local.activeVin)
        ? local.activeVin
        : cloudPayload.activeVin;

    const mergedActive = mergedCars.some(
      c => c.vin === requestedActive
    )
      ? requestedActive
      : (mergedCars[0]?.vin || "");

    const payload = {
      version: 1,
      cars: mergedCars,
      activeVin: mergedActive,
      syncedAt: new Date().toISOString()
    };

    // 4. Записваме обединените данни в облака.
    const { error: writeError } = await supabase
      .from("user_data")
      .upsert({
        user_id: userId,
        payload,
        updated_at: new Date().toISOString()
      });

    if (writeError) throw writeError;

    // 5. Запазваме същите данни локално.
    saveLocalData({
      cars: mergedCars,
      activeVin: mergedActive
    });

    // 6. Обновяваме визуализацията на гаража.
    if (typeof window.renderAll === "function") {
      window.renderAll();
    } else {
      window.location.reload();
    }

    status(
      "Синхронизацията е успешна. Автомобили: " +
      mergedCars.length +
      ". Последна синхронизация: " +
      new Date().toLocaleString("bg-BG"),
      "ok"
    );

  } catch (error) {
    console.error("M-GARAGE CLOUD SYNC:", error);

    status(
      "Грешка при синхронизация: " + error.message
    );

  } finally {
    setBusy(false);
  }
}

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
    } else {
      showLoggedOut();
    }

  } catch (error) {
    userStatus("Cloud Sync не е достъпен.");
    status(error.message);
  }
}

initializeCloud();

