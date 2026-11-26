
"use strict";

/* ==========================================
   M-GARAGE PRO
   Service Worker
   Version: 1.2
   CACHE UPDATE: v7
========================================== */

const CACHE_PREFIX = "m-garage-pro-";
const CACHE_NAME = CACHE_PREFIX + "v8";

/* ОСНОВНИ ФАЙЛОВЕ */

const CORE_ASSETS = [
  "./",
  "./index.html"
];

/* ДОПЪЛНИТЕЛНИ ФАЙЛОВЕ */

const OPTIONAL_ASSETS = [
  "./manifest.json",
  "./favicon.ico",
  "./cloud-sync.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* ==========================================
   CACHE RESPONSE
========================================== */

async function cacheResponse(request, response) {
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
}

/* ==========================================
   INSTALL
========================================== */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      await cache.addAll(CORE_ASSETS);

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

      console.log(
        "M-GARAGE PRO: Service Worker v1.2 activated."
      );
    })()
  );
});

/* ==========================================
   FETCH
========================================== */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/api/")) return;

  const isNavigation =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "")
      .includes("text/html");

  const isJavaScript =
    request.destination === "script" ||
    url.pathname.endsWith(".js");

  /* ========================================
     HTML: NETWORK FIRST
  ======================================== */

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          return await cacheResponse(
            "./index.html",
            response
          );

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

  /* ========================================
     JAVASCRIPT: NETWORK FIRST
     Винаги проверява за нова версия.
  ======================================== */

  if (isJavaScript) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          return await cacheResponse(
            request,
            response
          );

        } catch (error) {
          const cached = await caches.match(request);

          if (cached) return cached;

          return new Response(
            "JavaScript файлът не е достъпен офлайн.",
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

  /* ========================================
     ОСТАНАЛИ РЕСУРСИ: CACHE FIRST
  ======================================== */

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      try {
        const response = await fetch(request);

        return await cacheResponse(
          request,
          response
        );

      } catch (error) {
        return new Response("", {
          status: 503,
          statusText: "Offline"
        });
      }
    })()
  );
});
