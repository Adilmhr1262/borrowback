/* BorrowBack IndexedDB layer.
   Database: borrowback-db, version 1.
   Stores: records (keyPath "id"), settings (keyPath "key"). */
(function (global) {
  'use strict';

  var DB_NAME = 'borrowback-db';
  var DB_VERSION = 1;
  var DEFAULT_SETTINGS = { theme: 'system', dueSoonDays: 7 };

  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('records')) {
          db.createObjectStore('records', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
      req.onblocked = function () { reject(new Error('IndexedDB open blocked')); };
    });
    return dbPromise;
  }

  function requestToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB request failed')); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  }

  function getAllRecords() {
    return openDb().then(function (db) {
      return requestToPromise(db.transaction('records', 'readonly').objectStore('records').getAll());
    });
  }

  function putRecord(record) {
    return openDb().then(function (db) {
      var tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').put(record);
      return txDone(tx);
    });
  }

  function deleteRecord(id) {
    return openDb().then(function (db) {
      var tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').delete(id);
      return txDone(tx);
    });
  }

  function getSettings() {
    return openDb().then(function (db) {
      var tx = db.transaction('settings', 'readonly');
      var store = tx.objectStore('settings');
      return Promise.all([
        requestToPromise(store.get('theme')),
        requestToPromise(store.get('dueSoonDays'))
      ]).then(function (results) {
        return {
          theme: results[0] ? results[0].value : DEFAULT_SETTINGS.theme,
          dueSoonDays: results[1] ? results[1].value : DEFAULT_SETTINGS.dueSoonDays
        };
      });
    });
  }

  function saveSettings(settings) {
    return openDb().then(function (db) {
      var tx = db.transaction('settings', 'readwrite');
      var store = tx.objectStore('settings');
      store.put({ key: 'theme', value: settings.theme });
      store.put({ key: 'dueSoonDays', value: settings.dueSoonDays });
      return txDone(tx);
    });
  }

  /* Atomic replace of all records and settings in a single transaction. */
  function replaceAll(records, settings) {
    return openDb().then(function (db) {
      var tx = db.transaction(['records', 'settings'], 'readwrite');
      var recStore = tx.objectStore('records');
      var setStore = tx.objectStore('settings');
      recStore.clear();
      records.forEach(function (r) { recStore.put(r); });
      setStore.clear();
      setStore.put({ key: 'theme', value: settings.theme });
      setStore.put({ key: 'dueSoonDays', value: settings.dueSoonDays });
      return txDone(tx);
    });
  }

  function clearAll() {
    return openDb().then(function (db) {
      var tx = db.transaction(['records', 'settings'], 'readwrite');
      tx.objectStore('records').clear();
      tx.objectStore('settings').clear();
      return txDone(tx);
    });
  }

  global.BorrowBackDB = {
    openDb: openDb,
    getAllRecords: getAllRecords,
    putRecord: putRecord,
    deleteRecord: deleteRecord,
    getSettings: getSettings,
    saveSettings: saveSettings,
    replaceAll: replaceAll,
    clearAll: clearAll,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})(typeof window !== 'undefined' ? window : globalThis);
