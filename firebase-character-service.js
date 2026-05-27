(function (window) {
  const SLOT_COLLECTION = "characterSlots";

  function _ensureFirebase() {
    if (typeof firebase === "undefined") {
      throw new Error("Firebase no está cargado. Asegúrate de incluir firebase-app-compat.js y firebase-auth-compat.js / firebase-firestore-compat.js.");
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

  function _slotDocRef(userId, slotIndex) {
    return _getFirestore().doc(`${SLOT_COLLECTION}/user_${userId}/slots/slot_${slotIndex}`);
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

    async uploadCharacterSlot(userId, slotIndex, slotData) {
      if (!userId || typeof slotIndex === "undefined" || slotIndex === null) {
        throw new Error("userId y slotIndex son obligatorios.");
      }
      const data = Object.assign({}, slotData || {});
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await _slotDocRef(userId, slotIndex).set(data, { merge: true });
      return data;
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