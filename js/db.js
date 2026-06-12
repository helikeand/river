var db = (function() {
  var DB_NAME = 'autoAnswerDB';
  var DB_VERSION = 1;
  var STORE_NAME = 'questions';
  var _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          var store = database.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('question', 'question', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('source', 'source', { unique: false });
          store.createIndex('importedAt', 'importedAt', { unique: false });
        }
      };
      req.onsuccess = function(e) {
        _db = e.target.result;
        resolve(_db);
      };
      req.onerror = function() { reject(req.error); };
    });
  }

  async function addBatch(questions) {
    var database = await open();
    return new Promise(function(resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        store.add({
          question: q.question,
          answer: q.answer,
          type: q.type || 'unknown',
          options: q.options || null,
          source: q.source || 'unknown',
          importedAt: Date.now()
        });
      }
      tx.oncomplete = function() { resolve(questions.length); };
      tx.onerror = function() { reject(tx.error); };
    });
  }

  async function getAll() {
    var database = await open();
    return new Promise(function(resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var req = store.getAll();
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }

  async function count() {
    var database = await open();
    return new Promise(function(resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var req = store.count();
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }

  async function countByType() {
    var all = await getAll();
    var choice = 0, tf = 0, unknown = 0;
    for (var i = 0; i < all.length; i++) {
      if (all[i].type === 'choice') choice++;
      else if (all[i].type === 'truefalse') tf++;
      else unknown++;
    }
    return { total: all.length, choice: choice, truefalse: tf, unknown: unknown };
  }

  async function clearAll() {
    var database = await open();
    return new Promise(function(resolve, reject) {
      var tx = database.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var req = store.clear();
      req.onsuccess = function() { resolve(); };
      req.onerror = function() { reject(req.error); };
    });
  }

  async function bulkSearchByKeywords(keywords) {
    var all = await getAll();
    var lowerKeys = [];
    for (var i = 0; i < keywords.length; i++) {
      lowerKeys.push(keywords[i].toLowerCase());
    }
    return all.filter(function(q) {
      var qLower = q.question.toLowerCase();
      for (var j = 0; j < lowerKeys.length; j++) {
        if (qLower.indexOf(lowerKeys[j]) !== -1) return true;
      }
      return false;
    });
  }

  return {
    open: open,
    addBatch: addBatch,
    getAll: getAll,
    count: count,
    countByType: countByType,
    clearAll: clearAll,
    bulkSearchByKeywords: bulkSearchByKeywords
  };
})();
