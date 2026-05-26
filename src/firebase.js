import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  signOut,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  setDoc,
  where,
  getFirestore,
  onSnapshot,
} from "firebase/firestore";
import { firebaseConfig, noteCollection } from "./wii.js";

let app = null;
export let auth = null;
export let db = null;
export let firebaseReady = false;

try {
  app = initializeApp(firebaseConfig);
  try {
    auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch (error) {
    console.warn("[firebase-auth-fallback]", error);
    auth = getAuth(app);
  }

  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    console.warn("[firebase-db-fallback]", error);
    db = getFirestore(app);
  }
  firebaseReady = true;
} catch (error) {
  console.warn("[firebase-disabled]", error);
}

function requireFirebase() {
  if (!firebaseReady || !auth || !db) throw new Error("Firebase no esta disponible en este entorno.");
}

export const onUser = (fn) => {
  if (!auth) {
    queueMicrotask(() => fn(null));
    return () => {};
  }
  return onAuthStateChanged(auth, fn);
};

export async function loginEmail(email, password) {
  requireFirebase();
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

const authErrors = {
  "auth/email-already-in-use": "Email ya registrado.",
  "auth/weak-password": "Contrasena debil. Minimo 6 caracteres.",
  "auth/invalid-credential": "Usuario/email o contrasena incorrectos.",
  "auth/invalid-email": "Email no valido.",
  "auth/missing-email": "Ingresa tu email o usuario.",
  "auth/too-many-requests": "Demasiados intentos. Intenta mas tarde.",
  "auth/popup-closed-by-user": "Se cerro la ventana de Google.",
  "auth/network-request-failed": "No hay conexion con Firebase en este momento.",
};

function friendly(error) {
  return new Error(authErrors[error?.code] || error?.message || "No pude completar la autenticacion.");
}

const cleanUser = (value = "") => value.toLowerCase().replace(/[^a-z0-9_-]/g, "").trim();

async function findProfileByUsername(username) {
  const direct = await getDoc(doc(db, "smiles", username));
  if (direct.exists()) return { id: direct.id, ...direct.data() };

  const byUser = await getDocs(query(collection(db, "smiles"), where("usuario", "==", username)));
  if (!byUser.empty) return { id: byUser.docs[0].id, ...byUser.docs[0].data() };

  return null;
}

export async function getProfile(user = auth?.currentUser) {
  requireFirebase();
  if (!user) return null;
  
  let profile = null;
  if (user.displayName) {
    const direct = await findProfileByUsername(cleanUser(user.displayName));
    if (direct) profile = { ...direct, uid: user.uid };
  }
  
  if (!profile) {
    const snap = await getDocs(query(collection(db, "smiles"), where("uid", "==", user.uid)));
    if (!snap.empty) {
      profile = { id: snap.docs[0].id, ...snap.docs[0].data(), uid: user.uid };
    }
  }
  
  if (!profile && user.email) {
    const byEmail = await getDocs(query(collection(db, "smiles"), where("email", "==", user.email)));
    if (!byEmail.empty) {
      profile = { id: byEmail.docs[0].id, ...byEmail.docs[0].data(), uid: user.uid };
    }
  }
  
  if (!profile) {
    profile = {
      uid: user.uid,
      usuario: user.displayName || user.email,
      nombre: user.displayName || "Usuario",
      email: user.email || "",
      rol: "smile",
      estado: "activo",
    };
  }
  
  // Garantizar que tenga avatar si el usuario de Google tiene uno
  if (!profile.avatar && (user.photoURL || user.photoUrl)) {
    profile.avatar = user.photoURL || user.photoUrl;
  }
  
  return profile;
}

export async function resolveEmail(input) {
  requireFirebase();
  const value = String(input || "").trim().toLowerCase();
  if (!value) throw new Error("Ingresa tu email o usuario.");
  if (value.includes("@")) return { email: value, profile: null };
  const username = cleanUser(value);
  const profile = await findProfileByUsername(username);
  if (!profile) throw new Error("Usuario no encontrado.");
  if (!profile.email) throw new Error("Este usuario no tiene email registrado.");
  return { email: profile.email, profile };
}

export async function loginCredential(input, password) {
  try {
    const { email, profile: preProfile } = await resolveEmail(input);
    const result = await signInWithEmailAndPassword(auth, email, password);
    const profile = preProfile || (await getProfile(result.user));
    if (profile?.estado === "pendiente") {
      await signOut(auth);
      throw new Error("Tu cuenta esta pendiente de activacion.");
    }
    return profile;
  } catch (error) {
    throw friendly(error);
  }
}

export async function registerAccount(payload) {
  requireFirebase();
  const email = String(payload.email || "").trim().toLowerCase();
  const usuario = cleanUser(payload.usuario);
  const nombre = String(payload.nombre || "").trim();
  const apellidos = String(payload.apellidos || "").trim();
  const password = String(payload.password || "");
  if (!/^[\w.-]+@([\w-]+\.)+[a-zA-Z]{2,7}$/.test(email)) throw new Error("Email invalido.");
  if (usuario.length < 4) throw new Error("Usuario minimo 4 caracteres.");
  if (!nombre) throw new Error("Ingresa tu nombre.");
  if (!apellidos) throw new Error("Ingresa tus apellidos.");
  if (password.length < 6) throw new Error("Contrasena minimo 6 caracteres.");
  if (password !== payload.password2) throw new Error("Las contrasenas no coinciden.");
  if (!payload.terms) throw new Error("Acepta los terminos y condiciones.");

  const userDoc = await getDoc(doc(db, "smiles", usuario));
  if (userDoc.exists()) throw new Error("Usuario no disponible.");
  const emailSnap = await getDocs(query(collection(db, "smiles"), where("email", "==", email)));
  if (!emailSnap.empty) throw new Error("Email ya registrado.");

  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName: usuario });
    await setDoc(doc(db, "smiles", usuario), {
      uid: result.user.uid,
      usuario,
      nombre,
      apellidos,
      email,
      rol: "smile",
      estado: "activo",
      terminos: true,
      tema: localStorage.getItem("zenwii_theme") ? JSON.parse(localStorage.getItem("zenwii_theme")) : "Paz|#29c72e",
      avatar: "",
      bio: "",
      plan: "free",
      segmento: "creador",
      verificado: false,
      registradoPor: "correo",
      creado: serverTimestamp(),
      actualizado: serverTimestamp(),
    });
    sendEmailVerification(result.user).catch(console.warn);
    return result.user;
  } catch (error) {
    throw friendly(error);
  }
}

export async function resetPassword(input) {
  try {
    const { email } = await resolveEmail(input);
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw friendly(error);
  }
}

export async function loginGoogle() {
  requireFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

let pendingGoogleUser = null;

export async function loginGoogleFlow() {
  try {
    const user = await loginGoogle();
    const snap = await getDocs(query(collection(db, "smiles"), where("uid", "==", user.uid)));
    if (!snap.empty) return { user, profile: snap.docs[0].data(), needsProfile: false };
    pendingGoogleUser = user;
    return { user, needsProfile: true };
  } catch (error) {
    throw friendly(error);
  }
}

export async function completeGoogleRegistration(payload) {
  requireFirebase();
  if (!pendingGoogleUser) throw new Error("Vuelve a conectar Google.");
  const usuario = cleanUser(payload.usuario);
  if (usuario.length < 4) throw new Error("Usuario minimo 4 caracteres.");
  if (!payload.terms) throw new Error("Acepta los terminos y condiciones.");
  const userDoc = await getDoc(doc(db, "smiles", usuario));
  if (userDoc.exists()) throw new Error("Usuario no disponible.");
  if (payload.password && payload.password.length >= 6) {
    updatePassword(pendingGoogleUser, payload.password).catch(console.warn);
  }
  await updateProfile(pendingGoogleUser, { displayName: usuario }).catch(console.warn);
  await setDoc(doc(db, "smiles", usuario), {
    uid: pendingGoogleUser.uid,
    usuario,
    nombre: pendingGoogleUser.displayName || usuario,
    apellidos: "",
    email: pendingGoogleUser.email || "",
    avatar: pendingGoogleUser.photoURL || "",
    rol: "smile",
    estado: "activo",
    terminos: true,
    bio: "",
    plan: "free",
    segmento: "creador",
    verificado: false,
    registradoPor: "google",
    tema: localStorage.getItem("zenwii_theme") ? JSON.parse(localStorage.getItem("zenwii_theme")) : "Paz|#29c72e",
    creado: serverTimestamp(),
    actualizado: serverTimestamp(),
  });
  pendingGoogleUser = null;
  return getProfile(auth.currentUser);
}

export async function autoCreateGoogleProfile(user) {
  requireFirebase();
  if (!user) return null;
  // Derive a safe username from displayName or email
  const rawName = user.displayName || user.email?.split("@")[0] || "user";
  let usuario = cleanUser(rawName);
  if (usuario.length < 4) usuario = `user${usuario}`;

  // Check if username already taken; append UID suffix if needed
  const userDoc = await getDoc(doc(db, "smiles", usuario));
  if (userDoc.exists()) {
    usuario = `${usuario}${user.uid.slice(0, 5)}`;
  }

  await setDoc(doc(db, "smiles", usuario), {
    uid: user.uid,
    usuario,
    nombre: user.displayName || usuario,
    apellidos: "",
    email: user.email || "",
    avatar: user.photoURL || "",
    rol: "smile",
    estado: "activo",
    terminos: true,
    bio: "",
    plan: "free",
    segmento: "creador",
    verificado: false,
    registradoPor: "google-desktop",
    tema: localStorage.getItem("zenwii_theme") ? JSON.parse(localStorage.getItem("zenwii_theme")) : "Paz|#29c72e",
    creado: serverTimestamp(),
    actualizado: serverTimestamp(),
  });

  return {
    uid: user.uid,
    usuario,
    nombre: user.displayName || usuario,
    email: user.email || "",
    avatar: user.photoURL || "",
    rol: "smile",
    estado: "activo",
  };
}

export const logout = () => (auth ? signOut(auth) : Promise.resolve());

export async function loadRemoteNotes(user) {
  if (!db) return [];
  if (!user?.email) return [];
  const snap = await getDocs(query(collection(db, noteCollection), where("email", "==", user.email)));
  return snap.docs.map((item) => {
    const data = item.data();
    const created = data.creado?.toMillis?.() || data.creado || Date.now();
    const updated = data.actualizado?.toMillis?.() || data.actualizado || created;
    return {
      id: item.id,
      title: data.titulo || "Documento sin titulo",
      content: data.contenido || "",
      contentMd: data.contenidoMd || "",
      pinned: !!data.pin,
      created,
      updated,
      synced: true,
      remote: true,
    };
  });
}

// Alias: carga única sin suscripción en tiempo real (útil cuando real-time sync está desactivado)
export const loadRemoteNotesOnce = loadRemoteNotes;


export async function saveRemoteNote(user, note) {
  requireFirebase();
  if (!user?.email || !note?.id) return;

  let username = user.usuario || user.displayName || user.email || "nota";
  if (username.includes("@")) {
    username = username.split("@")[0];
  }
  const cleanUsername = username.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const docId = `${cleanUsername}_${note.created}`;

  const oldId = note.id;
  if (oldId !== docId) {
    try {
      await deleteDoc(doc(db, noteCollection, oldId));
    } catch (e) {
      console.warn("[delete-old-remote-failed]", e);
    }
  }

  await setDoc(
    doc(db, noteCollection, docId),
    {
      id: docId,
      usuario: cleanUsername,
      email: user.email,
      titulo: note.title || "Documento sin titulo",
      contenido: note.content || "",
      contenidoMd: note.contentMd || "",
      pin: !!note.pinned,
      creado: note.remote ? note.created : serverTimestamp(),
      actualizado: serverTimestamp(),
    },
    { merge: true },
  );
  return docId;
}

export function subscribeRemoteNotes(user, onUpdate) {
  if (!db) return () => {};
  if (!user?.email) return () => {};
  return onSnapshot(
    query(collection(db, noteCollection), where("email", "==", user.email)),
    (snap) => {
      const notes = snap.docs.map((item) => {
        const data = item.data();
        const created = data.creado?.toMillis?.() || data.creado || Date.now();
        const updated = data.actualizado?.toMillis?.() || data.actualizado || created;
        return {
          id: item.id,
          title: data.titulo || "Documento sin titulo",
          content: data.contenido || "",
          contentMd: data.contenidoMd || "",
          pinned: !!data.pin,
          created,
          updated,
          synced: true,
          remote: true,
        };
      });
      onUpdate(notes);
    },
    (error) => {
      console.warn("[onSnapshot-error]", error);
    }
  );
}

export async function deleteRemoteNote(user, id) {
  if (!db) return;
  if (!user?.email || !id) return;
  await deleteDoc(doc(db, noteCollection, id));
}

export async function loadPreferences(user) {
  if (!db) return null;
  if (!user?.uid) return null;
  const snap = await getDoc(doc(db, "zenwiiPreferences", user.uid));
  return snap.exists() ? snap.data() : null;
}

export async function savePreferences(user, preferences) {
  requireFirebase();
  if (!user?.uid) return;
  await setDoc(
    doc(db, "zenwiiPreferences", user.uid),
    {
      uid: user.uid,
      email: user.email || "",
      ...preferences,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function loginWithGoogleCredential(idToken, accessToken) {
  requireFirebase();
  try {
    let credential;
    let result;
    
    try {
      // 1. Intentar iniciar sesión con ambos tokens (Google ID Token y Access Token)
      credential = GoogleAuthProvider.credential(idToken, accessToken);
      result = await signInWithCredential(auth, credential);
    } catch (authError) {
      // 2. Si falla debido a que el navegador sirvió una versión en caché de desktop-auth.html
      // (la cual envía el token de Firebase en lugar del token de Google),
      // reintentamos inmediatamente de forma transparente usando únicamente el accessToken de Google,
      // el cual es 100% inmune a la caché y permite autenticar al usuario de manera oficial y robusta.
      if (accessToken && (authError.code === "auth/invalid-credential" || authError.message?.includes("credential"))) {
        console.warn("[Google Auth Fallback] Reintentando solo con accessToken de Google debido a caché del navegador.");
        credential = GoogleAuthProvider.credential(null, accessToken);
        result = await signInWithCredential(auth, credential);
      } else {
        throw authError;
      }
    }
    
    const user = result.user;
    const snap = await getDocs(query(collection(db, "smiles"), where("uid", "==", user.uid)));
    if (!snap.empty) {
      const profile = {
        id: snap.docs[0].id,
        ...snap.docs[0].data(),
        uid: user.uid,
      };
      // Garantizar que tenga avatar si el usuario de Google tiene uno
      if (!profile.avatar && (user.photoURL || user.photoUrl)) {
        profile.avatar = user.photoURL || user.photoUrl;
      }
      return { user, profile, needsProfile: false };
    }
    pendingGoogleUser = user;
    return { user, needsProfile: true };
  } catch (error) {
    throw friendly(error);
  }
}
