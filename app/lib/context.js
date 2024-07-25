'use client'
import { createContext, useState, useEffect, useMemo } from 'react';
import { auth, firestore } from './firebase'; // Adjust the path as needed
import { useAuthState } from 'react-firebase-hooks/auth';

export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [user, setUser] = useAuthState(auth);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    if (user) {
      const fetchUserData = async () => {
        try {
          const userDoc = await firestore.doc(`users/${user.uid}`).get();
          if (userDoc.exists) {
            setUserData(userDoc.data());
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
        }
      };
      fetchUserData();
    } else {
      setUserData(null);
    }
  }, [user]);

  const contextValue = useMemo(() => ({ user, userData }), [user, userData]);

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
};
