/* ============================================================
   A2 Smart Simulator — Service Worker v3.0
   
   Estrategias:
   - HTML principal: Network-first (siempre la versión más reciente)
   - APIs externas:  Network-only (Gemini, ElevenLabs — nunca cachear)
   - Assets estáticos: Cache-first (fonts, imágenes, confetti)
   - questions.json: Network-first (puede actualizarse)
   ============================================================ */

const CACHE_NAME = 'a2-sim-v3';  // ← Incrementar para forzar invalidación
const STATIC_ASSETS = [
    './shivi.png',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js'
];

// ── Install: pre-cache solo assets estáticos (NO el HTML ni JSON de preguntas)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err))
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// ── Activate: limpiar TODAS las caches antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
                console.log('[SW] Eliminando caché antigua:', k);
                return caches.delete(k);
            }))
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: estrategia por tipo de recurso
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // ── APIs externas: Network-only (nunca cachear)
    const networkOnlyHosts = [
        'generativelanguage.googleapis.com',  // Gemini
        'api.elevenlabs.io',                   // ElevenLabs TTS
    ];
    if (networkOnlyHosts.some(h => url.hostname.includes(h))) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(JSON.stringify({ error: 'offline' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // ── HTML y questions.json: Network-first (siempre actualizado)
    const isHTML = event.request.mode === 'navigate' ||
                   url.pathname.endsWith('.html') ||
                   url.pathname === '/' ||
                   url.pathname.endsWith('/');
    const isJSON = url.pathname.endsWith('questions.json');

    if (isHTML || isJSON) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Si la red responde bien, actualizar caché
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    // Sin red: usar caché como fallback
                    return caches.match(event.request).then(cached =>
                        cached || caches.match('./index.html')
                    );
                })
        );
        return;
    }

    // ── Google Fonts: Stale-while-revalidate
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

    // ── Assets estáticos: Cache-first, fallback a red
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response && response.status === 200 && response.type !== 'opaque') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => {
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html');
            }
        })
    );
});
