/* IndexedDB 封装：tracks（路线）、photos（照片）两个仓库 */
const DB = (() => {
  const NAME = 'citywalk-db', VERSION = 1;
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }

  function run(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const rq = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(rq && rq.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  return {
    put: (store, val) => run(store, 'readwrite', s => s.put(val)),
    getAll: store => run(store, 'readonly', s => s.getAll()),
    del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
    clear: store => run(store, 'readwrite', s => s.clear()),
  };
})();
