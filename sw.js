/* ============================================================
   A2 Smart Simulator — Service Worker v1.0
   Estrategia: Cache-first para assets estáticos.
   La app funciona 100% offline (preguntas + UI).
   Gemini API sólo requiere internet.
   ============================================================ */

const CACHE_NAME = 'a2-sim-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './questions.json',
    './shivi.png',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js'
];

// ── Install: pre-cache todos los assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cache assets uno a uno para que un fallo no rompa todo
            return Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err))
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// ── Activate: limpiar caches antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: Cache-first para assets, Network-first para API de Gemini
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Gemini API — siempre red (no cacheable)
    if (url.hostname.includes('generativelanguage.googleapis.com')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(JSON.stringify({ error: 'offline' }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // Google Fonts — stale-while-revalidate
    if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const networkFetch = fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    return response;
                });
                return cached || networkFetch;
            })
        );
        return;
    }

    // Todo lo demás — Cache-first, fallback a red
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                // Solo cachear respuestas válidas
                if (response && response.status === 200 && response.type !== 'opaque') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => {
            // Offline fallback para navegación
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html');
            }
        })
    );
});
