/**
 * sw.js — INL Retro Web service worker.
 *
 * Caches all app files on install so the UI works completely offline
 * (no internet required after the first visit).  WebUSB communication
 * with the physical device is local and unaffected.
 *
 * Versioning: bump CACHE_NAME whenever any cached file changes, so
 * returning users get fresh assets and the old cache is cleaned up.
 */

const CACHE_NAME = 'inlretro-v1.0.0';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './js/app.js',
  './js/platforms.js',
  './js/utils.js',
  './js/dict.js',
  './js/dump.js',
  './js/nrom.js',
  './js/nes-mappers.js',
  './js/erase.js',
  './js/flash.js',
  './js/nes-flash.js',
  './js/snes-flash.js',
  './js/snes.js',
  './js/n64.js',
  './js/gb.js',
  './js/gba.js',
  './js/genesis.js',
  './js/components/Card.js',
  './js/components/DetailsSection.js',
  './js/components/CopyBtn.js',
  './js/components/InfoPanel.js',
  './js/components/ConfigCard.js',
  './js/components/ActionCard.js',
  './js/components/FlashCard.js',
  './js/components/TabBar.js',
  './js/components/DeviceCard.js',
  './js/components/ProgressCard.js',
  './js/components/LogPanel.js',
  './js/components/DownloadCard.js',
  './js/components/N64ConverterCard.js',
  './js/lib/preact.module.js',
  './js/lib/hooks.module.js',
  './js/lib/htm.module.js',
  './js/lib/htm-preact.js',
];

// ── Install: pre-cache all app files ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  // Activate immediately rather than waiting for old tabs to close
  self.skipWaiting();
});

// ── Activate: remove any caches from older versions ──────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  // Take control of already-open pages without a reload
  self.clients.claim();
});

// ── Fetch: serve from cache, fall back to network ────────────
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached ?? fetch(event.request))
  );
});
