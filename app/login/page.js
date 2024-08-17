'use client'
import { useState, useEffect, useContext, useCallback } from 'react';
import { auth, firestore, googleAuthProvider } from '../lib/firebase';
import { UserContext } from '../lib/context';
import debounce from 'lodash.debounce';
import styles from './Login.module.css';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

export default function Enter() {
  const { user, username } = useContext(UserContext);
  const router = useRouter();
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
  const router = useRouter();
  const { user, username } = useContext(UserContext);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (teamExists === null) return; // Prevent submission if team status is unknown

    const userDoc = firestore.doc(`users/${user.uid}`);
    const usernameDoc = firestore.doc(`usernames/${formValue}`);
    const teamDoc = firestore.doc(`teams/${teamNumber}`);

    const batch = firestore.batch();
    batch.set(userDoc, { username: formValue, photoURL: user.photoURL, displayName: user.displayName, teamNumber });
    batch.set(usernameDoc, { uid: user.uid });

    if (teamExists) {
      // Send a join request to the existing team
      batch.set(firestore.doc(`teams/${teamNumber}/requests/${user.uid}`), {
        username: formValue,
        uid: user.uid,
        photoURL: user.photoURL,
        displayName: user.displayName
      }
      );
      toast.success('Request Sent!')
      router.push(`/`);
    } else {
      // Fetch team details and create a new team
      const teamDetails = await fetchTeamDetails(teamNumber);
      if (teamDetails) {
        batch.set(teamDoc, { 
          teamNumber, 
          createdBy: user.uid,
          name: teamDetails.team_name,
          id: teamDetails.id,
          grade: teamDetails.grade,
          city: teamDetails.location.city,
          region: teamDetails.location.region,
          country: teamDetails.location.country,
          organization: teamDetails.organization,
          robotName: teamDetails.robot_name,
          members: [{
            uid: user.uid,
            username: formValue,
            photoURL: user.photoURL,
            displayName: user.displayName,
          }]
        });
      }
      toast.success('Team Created!')
      router.push(`/team/${teamNumber}`);
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

  const fetchTeamDetails = async (teamNumber) => {
    const apiToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIzIiwianRpIjoiMGI1MDhlNTEzZjEzNTk0ZjdkM2Y5NTQzNTM0MmJlNjBiOTI2ODI5ZTI1YWRiYmU5OGQyOWU4OTY1Y2ZlZWJjNjc5YTgxY2Y5MzgwZGNhNDkiLCJpYXQiOjE3MjE4NTc1NDIuMDgzNzY1LCJuYmYiOjE3MjE4NTc1NDIuMDgzNzY5MSwiZXhwIjoyNjY4NTQ1OTQyLjA3ODIyMTgsInN1YiI6IjEyNzgxNCIsInNjb3BlcyI6W119.Yrxi95Egb8P8cDD7mfPGwYMMBn6UtYRD9eI2XMcAr0x_bbKF58DC1QdAUIiN_mM4-D9B3dJNKSSzx__-xsQQolJUb9xjVs3fDXkWYqyupwtYkl-nbBO5cora5ryd8Fl9MT_-x71PN_LtaeOstYlTWPvRZjNNgxNhPH4-PA5ij0nzgcTc8MPQLcEg8TSVA0_YmvU_I8UVLweRxjG8OypEIysHfsHDSQhrmPFWf0Bup6gD6HFay1P0owkuQPaIrQKxnOgmmClqbWg30d3lxQdah4jQOseP_XAwPqdTVX-Q2ZxkxkDDE2LXlaR7GZQVG9c8rPbUh_vJeHNuGNPWb4P3dyVCcGk90RrFFYVCZ9bS7D2Xeke_Ciz8jiHxhYftz5IKBR9YLMdFAAYdh08hOTXLHS2AY9IuOUCdGbksxkeA9zhtRFyqCRN5cji88WKO8kL5HyO0M-0mLCk5EI6o5dj-qqWJsQ7omjOQ5Q_CNXAp8YeC6bDQwGMLvSiNR6dP3Res4b-D86X7O2Uy0BFbQEBsct0h33jQdqLVQuYB9UaWKNecbd1F8niKGWgzP6IKN75Ps8Waskq3ipJmO1_3DBo9EB7EReMxqOvBcs1YWLFizAPiUG7k9zF1zB_-XQtC-3piTTQbXquQHlakC8YW9RgeeK9d0CK1ZYosfzDvv7ndwgg'; // Replace with your actual API token
  
    try {
      const response = await fetch(`https://www.robotevents.com/api/v2/teams?number%5B%5D=${teamNumber}&myTeams=false`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) {
        throw new Error(`Error fetching team details: ${response.statusText}`);
      }
  
      const data = await response.json();
      return data.data[0];
    } catch (error) {
      console.error('Failed to fetch team details:', error);
      return null; // Return null or handle the error accordingly
    }
  };

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
