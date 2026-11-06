// Data layer. Two interchangeable backends:
//   - Firebase (Google login + Firestore cloud database)  -> used when firebase-config.js is filled in
//   - Local demo (this browser only)                      -> used otherwise, so you can try the site first
import { firebaseConfig } from './firebase-config.js';

export const cloudReady = !!firebaseConfig.apiKey && !/^PASTE/i.test(firebaseConfig.apiKey);
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

let F = null, auth = null, fdb = null, uid = null, authCb = null, errCb = null;
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clean = (o) => JSON.parse(JSON.stringify(o)); // Firestore rejects `undefined`
export const onError = (fn) => { errCb = fn; };

/* ---------------- local demo backend ---------------- */
const LP = 'ftmj_';
const lread = (c) => { try { return JSON.parse(localStorage.getItem(LP + c) || '{}'); } catch { return {}; } };
const lwrite = (c, o) => localStorage.setItem(LP + c, JSON.stringify(o));
const subs = {};
const arr = (c) => Object.entries(lread(c)).map(([id, v]) => ({ id, ...v }));
const emit = (c) => { const a = arr(c); (subs[c] || []).slice().forEach((f) => f(a)); };

/* ---------------- auth ---------------- */
export async function init(cb) {
  authCb = cb;
  if (!cloudReady) {
    uid = 'demo';
    cb(localStorage.getItem(LP + 'demoflag') === '1' ? { uid: 'demo', name: 'Demo mode', email: '', demo: true } : null);
    return;
  }
  const [app, au, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  F = { ...au, ...fs };
  const a = app.initializeApp(firebaseConfig);
  auth = au.getAuth(a);
  fdb = fs.getFirestore(a);
  au.onAuthStateChanged(auth, (u) => {
    uid = u ? u.uid : null;
    cb(u ? { uid: u.uid, name: u.displayName || 'Trader', email: u.email || '', photo: u.photoURL || '' } : null);
  });
}

export async function signInGoogle() {
  const p = new F.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try {
    await F.signInWithPopup(auth, p);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await F.signInWithRedirect(auth, p);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      throw e;
    }
  }
}

export function startDemo() {
  localStorage.setItem(LP + 'demoflag', '1');
  authCb && authCb({ uid: 'demo', name: 'Demo mode', email: '', demo: true });
}

export async function signOut() {
  if (cloudReady) await F.signOut(auth);
  else { localStorage.removeItem(LP + 'demoflag'); authCb && authCb(null); }
}

/* ---------------- database ---------------- */
export function listen(col, cb) {
  if (!cloudReady) {
    (subs[col] = subs[col] || []).push(cb);
    cb(arr(col));
    return () => { subs[col] = (subs[col] || []).filter((f) => f !== cb); };
  }
  return F.onSnapshot(
    F.collection(fdb, 'users', uid, col),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error(col, err); errCb && errCb(err); }
  );
}

export async function set(col, id, data, merge = false) {
  data = clean(data);
  if (!cloudReady) {
    const o = lread(col);
    o[id] = merge ? { ...(o[id] || {}), ...data } : data;
    lwrite(col, o);
    emit(col);
    return;
  }
  await F.setDoc(F.doc(fdb, 'users', uid, col, id), data, { merge });
}

export async function del(col, id) {
  if (!cloudReady) {
    const o = lread(col);
    delete o[id];
    lwrite(col, o);
    emit(col);
    return;
  }
  await F.deleteDoc(F.doc(fdb, 'users', uid, col, id));
}

export async function get(col, id) {
  if (!cloudReady) { const v = lread(col)[id]; return v ? { id, ...v } : null; }
  const s = await F.getDoc(F.doc(fdb, 'users', uid, col, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
