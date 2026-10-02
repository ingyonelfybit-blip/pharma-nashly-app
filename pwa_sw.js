// Pharma Nashly — service worker de la PWA.
//
// Guarda la app en el navegador para que abra aunque se caiga el internet.
// Los DATOS no pasan por aquí: Supabase es otro dominio y este worker no lo
// toca; la app lleva su propia cola sin conexión (SQLite en IndexedDB) y sube
// lo pendiente al volver la red.
//
// Estrategia:
// - Lo que cambia con cada versión (index, main.dart.js, arranque, listas de
//   recursos): primero la red (máximo 4 s) y, si no hay, lo guardado. Así una
//   versión nueva entra sola y sin internet abre la última que se usó.
// - Lo pesado que no cambia entre versiones (motor gráfico, SQLite, fuentes,
//   íconos): primero lo guardado, al instante.

const CACHE = 'pharma-nashly-v1';
const ESPERA_RED_MS = 4000;

// Lo mínimo para arrancar sin red. Si alguno no existe, se sigue (allSettled).
const BASE = [
  './',
  'index.html',
  'main.dart.js',
  'flutter.js',
  'flutter_bootstrap.js',
  'manifest.json',
  'favicon.png',
  'icons/Icon-192.png',
  'icons/Icon-512.png',
  'sqlite3.wasm',
  'sqflite_sw.js',
  'canvaskit/canvaskit.js',
  'canvaskit/canvaskit.wasm',
  'canvaskit/chromium/canvaskit.js',
  'canvaskit/chromium/canvaskit.wasm',
  'assets/AssetManifest.bin.json',
  'assets/FontManifest.json',
];

const INMUTABLE = /\/(canvaskit\/|assets\/fonts\/|assets\/packages\/|icons\/)|\.(wasm|ttf|otf|woff2?)$/;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(BASE.map((ruta) => cache.add(new Request(ruta, { cache: 'reload' })))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  // Solo lo de la propia app. Supabase y cualquier otro dominio, directo.
  if (url.origin !== self.location.origin) return;

  if (pedido.mode === 'navigate') {
    evento.respondWith(redPrimero(pedido, 'index.html'));
    return;
  }
  evento.respondWith(INMUTABLE.test(url.pathname) ? guardadoPrimero(pedido) : redPrimero(pedido));
});

async function guardadoPrimero(pedido) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(pedido);
  if (guardado) return guardado;
  const respuesta = await fetch(pedido);
  if (respuesta.ok) cache.put(pedido, respuesta.clone());
  return respuesta;
}

async function redPrimero(pedido, respaldo) {
  const cache = await caches.open(CACHE);
  try {
    const respuesta = await conLimite(fetch(pedido), ESPERA_RED_MS);
    if (respuesta.ok) cache.put(pedido, respuesta.clone());
    return respuesta;
  } catch (_) {
    const guardado = (await cache.match(pedido)) || (respaldo && (await cache.match(respaldo)));
    if (guardado) return guardado;
    return new Response('Pharma Nashly no está disponible sin conexión todavía. Ábrela una vez con internet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

function conLimite(promesa, ms) {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('sin red')), ms);
    promesa.then(
      (r) => {
        clearTimeout(reloj);
        resolver(r);
      },
      (e) => {
        clearTimeout(reloj);
        rechazar(e);
      },
    );
  });
}
