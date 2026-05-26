export const app = "Zenwii";
export const version = "v10";
export const defaultTheme = "Paz|#29c72e";
export const noteCollection = "notas";
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** ACTUALIZAR AL TAG POR SEGURIDAD [TAG NUEVO] (1)
git tag v10 -m "Version v10" ; git push origin v10

ACTUALIZACIÓN AL MAIN PRINCIPAL DEL PROYECTO [MAIN] (2)
git add . ; git commit -m "Actualizacion Principal v10.10.10" ; git push origin main 

// REEMPLAZAR TAG DE SEGURIDAD EXISTENTE [TAG REMPLAZO] (3)
git tag -d v10 ; git tag v10 -m "Version v10 actualizada" ; git push origin v10 --force

 ACTUALIZACION TAG[END] */
