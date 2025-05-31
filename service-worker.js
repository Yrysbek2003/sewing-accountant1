const CACHE_NAME = 'sewing-accountant-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/translations.js',
    '/manifest.json',
    '/offline.html',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-144.png',
    '/icons/icon-72.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Максимальный размер кэша (в байтах, например, 50 MB)
const CACHE_SIZE_LIMIT = 50 * 1024 * 1024;

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .catch(error => {
                console.error('Ошибка при кэшировании:', error);
            })
            .then(() => self.skipWaiting()) // Активировать новый SW сразу
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        console.log('Удаление старого кэша:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            ))
            .then(() => self.clients.claim()) // Захватить контроль над клиентами
    );
});

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Игнорировать запросы к сторонним API или не кэшируемым ресурсам
    if (requestUrl.pathname.startsWith('/api/') || event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Если есть кэшированный ответ, вернуть его
                if (response) {
                    // Обновить кэш в фоновом режиме (stale-while-revalidate)
                    event.waitUntil(
                        fetch(event.request)
                            .then(freshResponse => {
                                return caches.open(CACHE_NAME).then(cache => {
                                    cache.put(event.request, freshResponse.clone());
                                    limitCacheSize(CACHE_NAME, CACHE_SIZE_LIMIT);
                                });
                            })
                            .catch(() => console.warn('Не удалось обновить кэш:', event.request.url))
                    );
                    return response;
                }

                // Если нет кэшированного ответа, выполнить запрос
                return fetch(event.request)
                    .then(freshResponse => {
                        // Кэшировать успешный ответ
                        if (freshResponse.status === 200) {
                            event.waitUntil(
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(event.request, freshResponse.clone());
                                    limitCacheSize(CACHE_NAME, CACHE_SIZE_LIMIT);
                                })
                            );
                        }
                        return freshResponse;
                    })
                    .catch(() => {
                        // Возвращаем оффлайн-страницу для HTML-запросов
                        if (event.request.destination === 'document') {
                            return caches.match('/offline.html');
                        }
                        throw new Error('Оффлайн и нет кэша');
                    });
            })
            .catch(error => {
                console.error('Ошибка fetch:', error);
                // Возвращаем заглушку для других типов запросов
                return new Response('Оффлайн-режим: ресурс недоступен', { status: 503 });
            })
    );
});

self.addEventListener('message', event => {
    if (event.data.type === 'UPDATE_CACHE') {
        if (!event.data.data) {
            console.warn('Некорректные данные для кэширования');
            return;
        }
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
                cache.put('/data.json', new Response(JSON.stringify(event.data.data)));
                console.log('Кэш /data.json обновлен');
                limitCacheSize(CACHE_NAME, CACHE_SIZE_LIMIT);
            })
        );
    }
});

// Функция ограничения размера кэша
async function limitCacheSize(cacheName, maxSize) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    let totalSize = 0;

    // Подсчет размера кэша
    for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
        }
    }

    // Удаление старых записей, если превышен лимит
    while (totalSize > maxSize && keys.length > 0) {
        const oldestRequest = keys.shift();
        await cache.delete(oldestRequest);
        const response = await cache.match(oldestRequest);
        if (response) {
            const blob = await response.blob();
            totalSize -= blob.size;
        }
    }
}