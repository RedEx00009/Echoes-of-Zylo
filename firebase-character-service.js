(function (window) {
  const STORAGE_PREFIX = "personajes";
  const ACCESSORY_PREFIX = "accesorios";
  const SLOT_COLLECTION = "characterSlots";

  function _ensureFirebase() {
    if (typeof firebase === "undefined") {
      throw new Error("Firebase no está cargado. Asegúrate de incluir firebase-app-compat.js y firebase-auth-compat.js / firebase-firestore-compat.js / firebase-storage-compat.js.");
    }
    return firebase;
  }

  function _getApp() {
    const fb = _ensureFirebase();
    if (!fb.apps || fb.apps.length === 0) {
      throw new Error("Firebase no ha sido inicializado. Llama a FirebaseCharacterService.initFirebase(config) antes de usarlo.");
    }
    return fb.app();
  }

  function _getAuth() {
    return _getApp().auth ? _getApp().auth() : firebase.auth();
  }

  function _getFirestore() {
    return _getApp().firestore ? _getApp().firestore() : firebase.firestore();
  }

  function _getStorage() {
    return _getApp().storage ? _getApp().storage() : firebase.storage();
  }

  function _isRemoteUrl(value) {
    return typeof value === "string" && /^https?:\/\//.test(value);
  }

  function _toBlob(blobOrBase64) {
    if (!blobOrBase64) {
      throw new Error("Se requiere Blob o base64 para subir el archivo.");
    }
    if (blobOrBase64 instanceof Blob) return blobOrBase64;
    if (blobOrBase64 instanceof File) return blobOrBase64;
    if (typeof blobOrBase64 !== "string") {
      throw new Error("El valor debe ser un Blob, File o string base64.");
    }

    if (_isRemoteUrl(blobOrBase64)) {
      throw new Error("La URL remota debe ser convertida a Blob antes de llamar a _toBlob.");
    }

    const dataUrl = blobOrBase64.startsWith("data:") ? blobOrBase64 : `data:image/png;base64,${blobOrBase64}`;
    const [meta, base64] = dataUrl.split(",");
    const matches = meta.match(/data:([^;]+);base64/);
    const contentType = matches ? matches[1] : "image/png";
    const raw = atob(base64);
    const uint8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      uint8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uint8Array], { type: contentType });
  }

  async function _remoteUrlToBlob(url) {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`No se pudo descargar la URL remota: ${url}`);
    }
    return await response.blob();
  }

  async function _normalizeUploadSource(source) {
    if (!source) return null;
    if (source instanceof Blob || source instanceof File) return source;
    if (typeof source !== "string") {
      throw new Error("El valor de origen debe ser Blob, File, data URL o URL remota.");
    }
    if (_isRemoteUrl(source)) {
      return await _remoteUrlToBlob(source);
    }
    return _toBlob(source);
  }

  async function _uploadOptionalFile(storagePath, source) {
    if (!source) return null;
    const normalized = await _normalizeUploadSource(source);
    if (!normalized) return null;
    const storage = _getStorage();
    const ref = storage.ref().child(storagePath);
    await ref.put(normalized, { contentType: normalized.type || "image/png" });
    return await ref.getDownloadURL();
  }

  function _storagePathForSlot(userId, slotIndex, fileName) {
    return `${STORAGE_PREFIX}/user_${userId}/slot_${slotIndex}/${fileName}`;
  }

  function _storagePathForAccessory(userId, accessoryId) {
    return `${ACCESSORY_PREFIX}/user_${userId}/${accessoryId}.png`;
  }

  function _slotDocRef(userId, slotIndex) {
    return _getFirestore().doc(`${SLOT_COLLECTION}/user_${userId}/slots/slot_${slotIndex}`);
  }

  function _stripLocalDataURLs(data) {
    if (!data || typeof data !== "object") return data;
    const clone = JSON.parse(JSON.stringify(data));

    function strip(obj) {
      if (!obj || typeof obj !== "object") return;
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        if (typeof value === "string" && value.startsWith("data:")) {
          delete obj[key];
          return;
        }
        if (typeof value === "object") strip(value);
      });
    }

    strip(clone);
    return clone;
  }

  async function _uploadFile(storagePath, blobOrBase64, contentType = "image/png") {
    const storage = _getStorage();
    const blob = _toBlob(blobOrBase64);
    const ref = storage.ref().child(storagePath);
    await ref.put(blob, { contentType });
    return await ref.getDownloadURL();
  }

  const FirebaseCharacterService = {
    initFirebase(config) {
      _ensureFirebase();
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      return firebase.app();
    },

    getCurrentUserId() {
      const auth = _getAuth();
      return auth.currentUser ? auth.currentUser.uid : null;
    },

    async signInAnonymously() {
      const auth = _getAuth();
      if (auth.currentUser) return auth.currentUser;
      const result = await auth.signInAnonymously();
      return result.user;
    },

    async uploadAccessoryImage(userId, accessoryId, blobOrBase64) {
      if (!userId || !accessoryId) {
        throw new Error("userId y accessoryId son obligatorios.");
      }
      const storagePath = _storagePathForAccessory(userId, accessoryId);
      const url = await _uploadFile(storagePath, blobOrBase64);
      return {
        accessoryId,
        url,
        storagePath,
      };
    },

    async uploadCharacterSlot(userId, slotIndex, sheetBlobOrBase64, slotData) {
      if (!userId || typeof slotIndex === "undefined" || slotIndex === null) {
        throw new Error("userId y slotIndex son obligatorios.");
      }
      const cleanedData = _stripLocalDataURLs(slotData || {});
      const sourceSheet = sheetBlobOrBase64
        || cleanedData.spriteSheets?.sheet
        || cleanedData.spriteSheets?.base
        || cleanedData.spriteSheets?.pelea
        || cleanedData.spriteSheets?.combat
        || cleanedData.spriteSheets?.especial
        || cleanedData.spriteSheets?.special
        || null;

      let sheetUrl = null;
      if (sourceSheet) {
        sheetUrl = await _uploadOptionalFile(_storagePathForSlot(userId, slotIndex, "sheet.png"), sourceSheet);
      } else {
        sheetUrl = cleanedData.spriteSheets?.sheet
          || cleanedData.spriteSheets?.base
          || cleanedData.spriteSheets?.pelea
          || cleanedData.spriteSheets?.combat
          || cleanedData.spriteSheets?.especial
          || cleanedData.spriteSheets?.special
          || null;
      }

      cleanedData.spriteSheets = {};
      if (sheetUrl) {
        cleanedData.spriteSheets.sheet = sheetUrl;
        cleanedData.spriteSheets.base = sheetUrl;
        cleanedData.spriteSheets.pelea = sheetUrl;
        cleanedData.spriteSheets.especial = sheetUrl;
      }
      cleanedData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

      await _slotDocRef(userId, slotIndex).set(cleanedData, { merge: true });
      return cleanedData;
    },

    async getCharacterSlot(userId, slotIndex) {
      if (!userId || typeof slotIndex === "undefined" || slotIndex === null) {
        throw new Error("userId y slotIndex son obligatorios.");
      }
      const doc = await _slotDocRef(userId, slotIndex).get();
      return doc.exists ? doc.data() : null;
    },

    async listCharacterSlots(userId) {
      if (!userId) {
        throw new Error("userId es obligatorio.");
      }
      const collectionRef = _getFirestore().collection(`${SLOT_COLLECTION}/user_${userId}/slots`);
      const snapshot = await collectionRef.orderBy(firebase.firestore.FieldPath.documentId()).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },

    async downloadCharacterSlot(userId, slotIndex) {
      return await this.getCharacterSlot(userId, slotIndex);
    },
  };

  window.FirebaseCharacterService = FirebaseCharacterService;
})(window);