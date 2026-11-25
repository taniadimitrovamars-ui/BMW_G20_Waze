
"use strict";

/* ==========================================
   M-GARAGE PRO
   Service Worker
   Version: 1.0
========================================== */

const CACHE_PREFIX = "m-garage-pro-";
const CACHE_NAME = CACHE_PREFIX + "v2";

/* Основни файлове – необходими за стартиране */
const CORE_ASSETS = [
  "./",
  "./index.html"
];

/* Допълнителни файлове – кешират се, ако съществуват */
const OPTIONAL_ASSETS = [
  "./manifest.json",
  "./favicon.ico",
  "./cloud-sync.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* ==========================================
   INSTALL
========================================== */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Основните файлове трябва да се кешират успешно.
      await cache.addAll(CORE_ASSETS);

      // Липсващите допълнителни файлове не трябва
      // да блокират инсталацията.
      await Promise.allSettled(
        OPTIONAL_ASSETS.map(async (asset) => {
          try {
            await cache.add(asset);
          } catch (error) {
            console.warn(
              "M-GARAGE PRO: Optional asset not cached:",
              asset
            );
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

/* ==========================================
   ACTIVATE
========================================== */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) =>
            key.startsWith(CACHE_PREFIX) &&
            key !== CACHE_NAME
          )
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

/* ==========================================
   FETCH
========================================== */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Не обработваме POST, PUT, DELETE и други заявки.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Обработваме само файлове от същия домейн.
  if (url.origin !== self.location.origin) return;

  // Не кешираме заявки към API.
  if (url.pathname.includes("/api/")) return;

  const isNavigation =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "")
      .includes("text/html");

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          if (
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const cache = await caches.open(CACHE_NAME);

            await cache.put(
              "./index.html",
              response.clone()
            );
          }

          return response;

        } catch (error) {
          const cached = await caches.match("./index.html");

          if (cached) return cached;

          return new Response(
            "M-GARAGE PRO не може да се зареди. Отвори приложението онлайн поне веднъж.",
            {
              status: 503,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        }
      })()
    );

    return;
  }

  // Статични ресурси: първо кеш, после мрежа.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (
          response &&
          response.status === 200 &&
          response.type === "basic"
        ) {
          const cache = await caches.open(CACHE_NAME);

          await cache.put(
            request,
            response.clone()
          );
        }

        return response;

      } catch (error) {
        // Не връщаме HTML вместо изображение,
        // икона или друг статичен ресурс.
        return new Response("", {
          status: 503,
          statusText: "Offline"
        });
      }
    })()
  );
});
