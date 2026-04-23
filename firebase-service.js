const firebaseConfig = {
  apiKey: 'AIzaSyCw1ZRO3sxDBNR1ntCh2F8FsHrJhbkrG40',
  authDomain: 'himatrack-926ff.firebaseapp.com',
  projectId: 'himatrack-926ff',
  storageBucket: 'himatrack-926ff.firebasestorage.app',
  messagingSenderId: '188249737530',
  appId: '1:188249737530:web:1f68c516881692ef162803',
  measurementId: 'G-31TL3FG8JG'
};

let firebaseModulesPromise = null;
let firebaseState = null;

async function loadFirebaseModules() {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore')
    ]);
  }

  return firebaseModulesPromise;
}

async function getFirebase() {
  if (firebaseState) {
    return firebaseState;
  }

  const [appModule, authModule, firestoreModule] = await loadFirebaseModules();
  const app = appModule.initializeApp(firebaseConfig);
  const auth = authModule.getAuth(app);
  const firestore = firestoreModule.getFirestore(app);

  try {
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);
  } catch (error) {
    console.warn('Could not enable Firebase browser persistence:', error);
  }

  firebaseState = {
    app,
    auth,
    firestore,
    authModule,
    firestoreModule
  };

  return firebaseState;
}

function safeUser(firebaseUser) {
  if (!firebaseUser) {
    return null;
  }

  return {
    id: firebaseUser.uid,
    username: firebaseUser.email || 'Firebase user',
    email: firebaseUser.email || ''
  };
}

async function signUp(email, password) {
  const { auth, authModule, firestore, firestoreModule } = await getFirebase();
  const credential = await authModule.createUserWithEmailAndPassword(auth, email, password);
  const user = safeUser(credential.user);

  firestoreModule.setDoc(
    firestoreModule.doc(firestore, 'users', user.id),
    {
      email: user.email,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    },
    { merge: true }
  ).catch((error) => {
    console.warn('Could not save Firebase user profile during signup:', error);
  });

  return user;
}

async function signIn(email, password) {
  const { auth, authModule } = await getFirebase();
  const credential = await authModule.signInWithEmailAndPassword(auth, email, password);

  return safeUser(credential.user);
}

async function signOut() {
  const { auth, authModule } = await getFirebase();
  await authModule.signOut(auth);
}

async function getCurrentUser() {
  const { auth, authModule } = await getFirebase();

  if (auth.currentUser) {
    return safeUser(auth.currentUser);
  }

  return new Promise((resolve) => {
    const unsubscribe = authModule.onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribe();
      resolve(safeUser(firebaseUser));
    });
  });
}

async function saveUserProfile(user, device = {}) {
  if (!user?.id) {
    return;
  }

  const { firestore, firestoreModule } = await getFirebase();
  const now = new Date().toISOString();
  const deviceId = device.id || 'unknown-device';

  await firestoreModule.setDoc(
    firestoreModule.doc(firestore, 'users', user.id),
    {
      email: user.email || '',
      updatedAt: now,
      lastSeenAt: now,
      devices: {
        [deviceId]: {
          id: deviceId,
          name: device.name || 'Unknown device',
          platform: device.platform || '',
          lastSeenAt: now
        }
      }
    },
    { merge: true }
  );
}

async function saveUsageSegment(userId, segment) {
  if (!userId || !segment) {
    return;
  }

  const { firestore, firestoreModule } = await getFirebase();
  const documentId = segment.id || `${segment.deviceId || 'device'}-${segment.timestamp}-${Date.now()}`;

  await firestoreModule.setDoc(
    firestoreModule.doc(firestore, 'users', userId, 'usage', documentId),
    {
      id: documentId,
      appName: segment.appName,
      title: segment.title || '',
      executablePath: segment.executablePath || '',
      iconDataUrl: segment.iconDataUrl || '',
      taskName: segment.taskName || '',
      durationMs: Math.round(segment.durationMs),
      timestamp: segment.timestamp,
      deviceId: segment.deviceId || '',
      deviceName: segment.deviceName || '',
      devicePlatform: segment.devicePlatform || '',
      createdAt: new Date().toISOString()
    }
  );
}

async function loadUsageSince(userId, timestamp) {
  if (!userId) {
    return [];
  }

  const { firestore, firestoreModule } = await getFirebase();
  const usageQuery = firestoreModule.query(
    firestoreModule.collection(firestore, 'users', userId, 'usage'),
    firestoreModule.where('timestamp', '>=', timestamp),
    firestoreModule.orderBy('timestamp', 'asc')
  );
  const snapshot = await firestoreModule.getDocs(usageQuery);

  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data();

    return {
      id: data.id || docSnapshot.id,
      appName: data.appName || 'Unknown app',
      title: data.title || '',
      executablePath: data.executablePath || '',
      iconDataUrl: data.iconDataUrl || '',
      taskName: data.taskName || '',
      durationMs: Number(data.durationMs) || 0,
      timestamp: data.timestamp || '',
      deviceId: data.deviceId || '',
      deviceName: data.deviceName || '',
      devicePlatform: data.devicePlatform || ''
    };
  });
}

async function deleteAllUsage(userId) {
  if (!userId) {
    return;
  }

  const { firestore, firestoreModule } = await getFirebase();
  const snapshot = await firestoreModule.getDocs(
    firestoreModule.collection(firestore, 'users', userId, 'usage')
  );

  const batch = firestoreModule.writeBatch(firestore);
  snapshot.docs.forEach((docSnapshot) => {
    batch.delete(docSnapshot.ref);
  });

  await batch.commit();
}

module.exports = {
  getFirebase,
  signUp,
  signIn,
  signOut,
  getCurrentUser,
  saveUserProfile,
  saveUsageSegment,
  loadUsageSince,
  deleteAllUsage
};
