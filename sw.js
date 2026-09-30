/* BQOL Field - the service worker that keeps the app working offline.
   Cache first for the app's own files. The build replaces the version
   placeholder, so every new build gets a fresh cache and the old one goes. */
"use strict";

const CACHE_NAME = "bqol-field-551ca73f1db0";
const SHELL = [
    "./",
    "index.html",
    "app.js",
    "field.css",
    "manifest.webmanifest",
    "css/styles.css",
    "css/bqol-service.css",
    "fonts/Barlow-Regular.ttf",
    "fonts/Barlow-SemiBold.ttf",
    "fonts/Barlow-Italic.ttf",
    "fonts/BarlowCondensed-SemiBold.ttf",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    // Anything from another origin (the Industry sheet's font import) is left
    // to the browser: offline it simply fails, and the local fonts stand in.
    if (new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(fromCache(request));
});

async function fromCache(request) {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    try {
        return await fetch(request);
    } catch (error) {
        if (request.mode === "navigate") {
            const shell = await cache.match("index.html");
            if (shell) return shell;
        }
        throw error;
    }
}
