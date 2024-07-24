"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { auth, firestore } from '../lib/firebase';
import { useRouter } from 'next/navigation';
import styles from './Navbar.module.css';

const Navbar = () => {
  const [user, setUser] = useState(null);
  const [username, setUsername] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(''); // State for search input
  const router = useRouter(); // Use the router object

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUser(user);
        // Fetch the username from Firestore
        const userDoc = firestore.doc(`users/${user.uid}`);
        const doc = await userDoc.get();
        if (doc.exists) {
          setUsername(doc.data().username);
        }
      } else {
        setUser(null);
        setUsername('');
      }
    });

    return () => unsubscribe();
  }, []);

  const handleDropdownToggle = () => {
    setDropdownOpen(!dropdownOpen);
  };

  const handleLogout = () => {
    auth.signOut().then(() => {
      // Sign-out successful.
    }).catch((error) => {
      // An error happened.
      console.error("Error signing out: ", error);
    });
  };

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    // Redirect to the search results page
    router.push(`/search?term=${encodeURIComponent(searchTerm)}`);
  };

  return (
    <div className={styles.navbar}>
      <Link href="/" className={styles.logo}>
        <h1>VexTeamLink</h1>
      </Link>
      <form onSubmit={handleSearchSubmit} className={styles.searchForm}>
        <input
          type="text"
          placeholder="Search users and teams"
          value={searchTerm}
          onChange={handleSearchChange}
          className={styles.searchInput}
        />
      </form>
      <div className={styles.auth}>
        {user ? (
          <>
            <Link href="/messages">
              <img
                src="/messages-icon.png"
                alt="Messages"
                className={styles.messagesIcon}
              />
            </Link>
            <div className={styles.profileContainer}>
              <img
                src={user.photoURL || '/default-profile.png'}
                alt="Profile"
                className={styles.profilePic}
                onClick={handleDropdownToggle}
              />
              {dropdownOpen && (
                <div className={styles.dropdownMenu}>
                  <Link href={`/profile/${username}`}>Profile</Link>
                  <Link href="/settings">Settings</Link>
                  <button onClick={handleLogout}>Logout</button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Link href="/login">Login</Link>
        )}
      </div>
    </div>
  );
};

export default Navbar;
