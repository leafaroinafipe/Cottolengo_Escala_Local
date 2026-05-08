import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const snap = await getDoc(doc(db, 'usuarios', firebaseUser.uid));
          setProfile(snap.exists() ? snap.data() : null);
        } catch (err) {
          console.error('[auth] profile fetch failed:', err);
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login  = useCallback((email, password) => signInWithEmailAndPassword(auth, email, password), []);
  const logout = useCallback(() => signOut(auth), []);

  /* Memoiza o value para não re-renderizar todos os consumidores em todo render. */
  const value = useMemo(
    () => ({ user, profile, loading, login, logout }),
    [user, profile, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
