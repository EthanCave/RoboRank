// lib/context.js
'use client'
import { createContext, useState, useEffect } from 'react';
import { auth, firestore } from './firebase'; // Adjust the path as needed
import { useAuthState } from 'react-firebase-hooks/auth';

export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [user, setUser] = useAuthState(auth);
  const [username, setUsername] = useState('');

  useEffect(() => {
    if (user) {
      const userDoc = firestore.doc(`users/${user.uid}`);
      userDoc.get().then((doc) => {
        if (doc.exists) {
          setUsername(doc.data().username);
        }
      }).catch(error => {
        console.error("Error fetching user data: ", error);
      });
    } else {
      setUsername('');
    }
  }, [user]);

  return (
    <UserContext.Provider value={{ user, username }}>
      {children}
    </UserContext.Provider>
  );
};
