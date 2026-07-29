const DB_NAME = 'paperframe-studio';
const STORE = 'projects';
const PROJECT_ID = 'autosave';

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function loadAutosave() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(PROJECT_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAutosave(settings, photos) {
  const database = await openDatabase();
  const record = {
    id: PROJECT_ID,
    name: 'Untitled project',
    updatedAt: Date.now(),
    settings,
    photos: photos.map(photo => ({
      ...photo,
      url: undefined,
      file: photo.file
    }))
  };
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function clearAutosave() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).delete(PROJECT_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
