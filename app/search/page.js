"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import debounce from 'lodash.debounce';
import Fuse from 'fuse.js';
import { firestore } from '../lib/firebase';
import styles from './Search.module.css';

const Search = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchTerm = searchParams.get('term') || '';
  const [results, setResults] = useState({ users: [], teams: [] });
  const [fuzzyResults, setFuzzyResults] = useState({ users: [], teams: [] });

  const fetchResults = useCallback(async (normalizedSearchTerm) => {
    if (normalizedSearchTerm) {
      // Fetch users
      const usersRef = firestore.collection('users');
      const userQuery = usersRef.get();
      const userDocs = await userQuery;
      const users = userDocs.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      console.log('Fetched users:', users);

      // Fetch teams
      const teamsRef = firestore.collection('teams');
      const teamDocs = await teamsRef.get();
      const teams = teamDocs.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      console.log('Fetched teams:', teams);

      // Fuzzy search setup
      const fuseUsers = new Fuse(users, { keys: ['username'], threshold: 0.3 });
      const fuseTeams = new Fuse(teams, { keys: ['teamNumber'], threshold: 0.3 });

      const userResults = fuseUsers.search(normalizedSearchTerm).map(result => result.item);
      const teamResults = fuseTeams.search(normalizedSearchTerm).map(result => result.item);

      setResults({ users, teams });
      setFuzzyResults({ users: userResults, teams: teamResults });

      console.log('Fuzzy search results - Users:', userResults);
      console.log('Fuzzy search results - Teams:', teamResults);
    }
  }, []);

  const debouncedFetchResults = useCallback(debounce(fetchResults, 300), [fetchResults]);

  useEffect(() => {
    debouncedFetchResults(searchTerm.toLowerCase());
    // Cleanup function to cancel debounce on unmount
    return () => {
      debouncedFetchResults.cancel();
    };
  }, [searchTerm, debouncedFetchResults]);

  const handleMessageClick = (recipient) => {
    // Navigate to messaging page with selected user or team
    router.push(`/messages?recipientId=${recipient.id}&type=${recipient.type}`);
  };

  const generateGradientBackground = () => {
    const colors = [
      '#ff9a9e', '#fad0c4', '#fad0c4', '#fbc2eb', '#a18cd1', '#fbc2eb', '#a6c0fe',
      '#f68084', '#fcabff', '#fbc2eb', '#ffdde1', '#c9ffbf', '#fbd3e9'
    ];
    const color1 = colors[Math.floor(Math.random() * colors.length)];
    const color2 = colors[Math.floor(Math.random() * colors.length)];
    return `linear-gradient(135deg, ${color1}, ${color2})`;
  };

  return (
    <div className={styles.searchPage}>
      <h1>Search Results for "{searchTerm}"</h1>
      <div className={styles.results}>
        <section>
          <h2>Users</h2>
          <div className={styles.emblemContainer}>
            {fuzzyResults.users.map(user => (
              <div key={user.id} className={styles.emblem}>
                <img
                  src={user.photoURL || '/default-profile.png'}
                  alt={user.username}
                  className={styles.emblemImage}
                />
                <span className={styles.emblemText}>{user.username}</span>
                <button
                  className={styles.messageButton}
                  onClick={() => handleMessageClick({ id: user.id, type: 'user' })}
                >
                  Message
                </button>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h2>Teams</h2>
          <div className={styles.emblemContainer}>
            {fuzzyResults.teams.map(team => {
              const teamNumber = team.teamNumber || '';
              const gradient = generateGradientBackground();

              return (
                <div key={team.id} className={styles.emblem}>
                  <div
                    className={styles.emblemImage}
                    style={{
                      background: team.photoURL ? 'none' : gradient,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '24px',
                      color: '#fff',
                      fontWeight: 'bold',
                    }}
                  >
                    {team.photoURL ? (
                      <img src={team.photoURL} alt={team.name} />
                    ) : (
                      teamNumber
                    )}
                  </div>
                  <span className={styles.emblemText}>{team.name}</span>
                  <button
                    className={styles.messageButton}
                    onClick={() => handleMessageClick({ id: team.id, type: 'team' })}
                  >
                    Message
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Search;
