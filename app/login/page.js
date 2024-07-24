"use client";

import { useState, useEffect, useContext, useCallback } from 'react';
import { auth, firestore, googleAuthProvider } from '../lib/firebase';
import { UserContext } from '../lib/context';
import debounce from 'lodash.debounce';
import styles from './Login.module.css';

export default function Enter() {
  const { user, username } = useContext(UserContext);

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>VexTeamLink</h1>
        {user ? (!username ? <UsernameForm /> : <SignOutButton />) : <SignInButton />}
      </div>
    </main>
  );
}

function SignInButton() {
  const signInWithGoogle = async () => {
    await auth.signInWithPopup(googleAuthProvider);
  };

  return (
    <button className={styles.button} onClick={signInWithGoogle}>
      <img src="/google.png" width="30px" alt="Google logo" /> Sign in with Google
    </button>
  );
}

function SignOutButton() {
  return <button className={styles.button} onClick={() => auth.signOut()}>Sign Out</button>;
}

function UsernameForm() {
  const [formValue, setFormValue] = useState('');
  const [teamNumber, setTeamNumber] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [teamExists, setTeamExists] = useState(null);

  const { user, username } = useContext(UserContext);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (teamExists === null) return; // Prevent submission if team status is unknown

    const userDoc = firestore.doc(`users/${user.uid}`);
    const usernameDoc = firestore.doc(`usernames/${formValue}`);
    const teamDoc = firestore.doc(`teams/${teamNumber}`);

    const batch = firestore.batch();
    batch.set(userDoc, { username: formValue, photoURL: user.photoURL, displayName: user.displayName, teamNumber: null });
    batch.set(usernameDoc, { uid: user.uid });

    if (teamExists) {
      // Send a join request to the existing team
      batch.set(firestore.doc(`teams/${teamNumber}/requests/${user.uid}`), {
        username: formValue,
        uid: user.uid,
        photoURL: user.photoURL,
        displayName: user.displayName
      });
    } else {
      // Create a new team
      batch.set(teamDoc, { teamNumber, createdBy: user.uid });
    }

    await batch.commit();
  };

  const onUsernameChange = (e) => {
    const val = e.target.value.toLowerCase();
    const re = /^(?=[a-zA-Z0-9._]{3,15}$)(?!.*[_.]{2})[^_.].*[^_.]$/;

    if (val.length < 3) {
      setFormValue(val);
      setLoading(false);
      setIsValid(false);
    } else if (re.test(val)) {
      setFormValue(val);
      setLoading(true);
      setIsValid(true);
    }
  };

  const onTeamNumberChange = (e) => {
    const val = e.target.value.toUpperCase();
    setTeamNumber(val);

    if (/^\d{2,6}[A-Z]$/.test(val)) {
      checkTeamExists(val);
    } else {
      setTeamExists(null);
    }
  };

  const checkTeamExists = useCallback(
    debounce(async (teamNumber) => {
      if (teamNumber.length >= 3) {
        const ref = firestore.doc(`teams/${teamNumber}`);
        const { exists } = await ref.get();
        setTeamExists(exists);
        setLoading(false);
      }
    }, 500),
    []
  );

  return (
    !username && (
      <section>
        <h3>Choose Username and Team Number</h3>
        <form onSubmit={onSubmit}>
          <input
            name="username"
            placeholder="Username"
            value={formValue}
            onChange={onUsernameChange}
          />
          <input
            name="teamNumber"
            placeholder="Team Number (e.g., 1234A)"
            value={teamNumber}
            onChange={onTeamNumberChange}
          />
          <UsernameMessage username={formValue} isValid={isValid} loading={loading} />
          <TeamNumberMessage teamNumber={teamNumber} teamExists={teamExists} loading={loading} />
          <button type="submit" className={styles.button} disabled={!isValid || loading || teamExists === null}>
            {teamExists ? 'Request to Join Team' : 'Create Team'}
          </button>
        </form>
      </section>
    )
  );
}

function UsernameMessage({ username, isValid, loading }) {
  if (loading) {
    return <p>Checking...</p>;
  } else if (isValid) {
    return <p>{username} is available!</p>;
  } else if (username && !isValid) {
    return <p>That username is taken!</p>;
  } else {
    return null;
  }
}

function TeamNumberMessage({ teamNumber, teamExists, loading }) {
  if (loading) {
    return <p>Checking team...</p>;
  } else if (teamExists === true) {
    return <p>Team {teamNumber} exists. You can request to join.</p>;
  } else if (teamExists === false) {
    return <p>Team {teamNumber} does not exist. You can create it.</p>;
  } else {
    return null;
  }
}
