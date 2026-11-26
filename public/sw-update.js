/*
 * Offline: handing open windows over to a new version. Loaded into the generated service worker
 * (vite.config.ts, workbox.importScripts), which takes over at once (skipWaiting, clientsClaim).
 *
 * Each open window is told about the new version. Windows running this code or later answer and
 * decide for themselves: reload now if nothing is open, or offer a reload if a page is open.
 * Windows on an older version cannot answer; they are reloaded once, so nobody stays on an old
 * build until every tab happens to close (which on a desktop can be never).
 *
 * The reloads start only after activation has finished: page requests wait for an activated
 * worker, so waiting on them inside activate would deadlock and leave a blank page.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: 'window' });
      const stale = (await Promise.all(windows.map(ask))).filter(Boolean);
      if (stale.length) {
        setTimeout(() => {
          for (const client of stale) {
            if (typeof client.navigate === 'function') client.navigate(client.url).catch(() => {});
          }
        }, 300);
      }
    })().catch(() => {}),
  );
});

/** Resolves to the client if it did not answer (an older version), or null if it did. */
function ask(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(client), 1500);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(null);
    };
    try {
      client.postMessage({ type: 'offline:new-version' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
