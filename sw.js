// ── Signal Dashboard Service Worker ───────────────────────────────────
// Handles background push notifications and offline caching

const CACHE_NAME = 'signal-dashboard-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: cache core assets ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {
        // Non-fatal — some assets may not exist yet
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache with network fallback ─────────────────────
self.addEventListener('fetch', event => {
  // Only cache same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

// ── Push: receive push notification from server ────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'Signal Alert', body: event.data?.text() || '' }; }

  const signal  = data.signal  || 'SIGNAL';
  const pair    = data.pair    || '';
  const risk    = data.risk    || '';
  const entry   = data.entry   || '';
  const sl      = data.sl      || '';
  const tp      = data.tp      || '';
  const conf    = data.confidence != null ? `${data.confidence}% confidence · ` : '';

  const icon    = signal === 'BUY' ? '📈' : signal === 'SELL' ? '📉' : '📊';
  const title   = `${icon} ${signal} — ${pair}`;
  const body    = `${conf}${risk}\nEntry ${entry} · SL ${sl} · TP ${tp}`;
  const tag     = `signal-${pair}-${signal}`;

  // LOW RISK signals stay on screen until dismissed
  const requireInteraction = risk.includes('LOW RISK');

  // Vibration pattern: BUY = 3 pulses, SELL = 2 pulses, other = 1
  const vibrate = signal === 'BUY' ? [200,100,200,100,200] :
                  signal === 'SELL' ? [200,100,200] : [300];

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      requireInteraction,
      vibrate,
      data: { url: '/', signal, pair },
    })
  );
});

// ── Notification click: open or focus the app ─────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ── Background sync: re-fetch signal when connection restores ─────────
self.addEventListener('sync', event => {
  if (event.tag === 'signal-sync') {
    event.waitUntil(
      // Notify all open clients to refresh
      clients.matchAll({ type: 'window' }).then(clientList => {
        clientList.forEach(client => client.postMessage({ type: 'SYNC_REFRESH' }));
      })
    );
  }
});
