"use client";

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { auth, googleAuthProvider } from '../lib/firebase';

export default function Login() {
  const router = useRouter();

  const signInWithGoogle = async () => {
    try {
      await auth.signInWithPopup(googleAuthProvider);
      router.push('/');
    } catch (error) {
      console.error("Error signing in with Google: ", error);
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        router.push('/');
      }
    });

    return () => unsubscribe();
  }, [router]);

  return (
    <div>
      <h1>Login</h1>
      <button onClick={signInWithGoogle}>Sign in with Google</button>
    </div>
  );
}
