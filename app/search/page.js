"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Fuse from 'fuse.js';
import { firestore } from '../lib/firebase';
import styles from './Search.module.css';

const Search = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchTerm = searchParams.get('term') || '';
  const [results, setResults] = useState({ users: [], teams: [] });
  const [fuzzyResults, setFuzzyResults] = useState({ users: [], teams: [] });

  useEffect(() => {
    const fetchResults = async () => {
      if (searchTerm) {
        const normalizedSearchTerm = searchTerm.toLowerCase();

        // Fetch users and teams
        const usersRef = firestore.collection('users');
        const teamsRef = firestore.collection('teams');

        const userQuery = usersRef.get();
        const teamQuery = teamsRef.get();

        const [userDocs, teamDocs] = await Promise.all([
          userQuery,
          teamQuery
        ]);

        const users = userDocs.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const teams = teamDocs.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Fuzzy search setup
        const fuseUsers = new Fuse(users, { keys: ['username'], threshold: 0.3 });
        const fuseTeams = new Fuse(teams, { keys: ['name'], threshold: 0.3 });

        const userResults = fuseUsers.search(normalizedSearchTerm).map(result => result.item);
        const teamResults = fuseTeams.search(normalizedSearchTerm).map(result => result.item);

        setResults({ users, teams });
        setFuzzyResults({ users: userResults, teams: teamResults });
      }
    };

    fetchResults();
  }, [searchTerm]);

  const handleMessageClick = (recipient) => {
    // Navigate to messaging page with selected user or team
    router.push(`/messages?recipientId=${recipient.id}&type=${recipient.type}`);
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
            {fuzzyResults.teams.map(team => (
              <div key={team.id} className={styles.emblem}>
                <div className={styles.emblemImage}>
                  <img src="/team-logo.png" alt={team.name} />
                </div>
                <span className={styles.emblemText}>{team.name}</span>
                <button
                  className={styles.messageButton}
                  onClick={() => handleMessageClick({ id: team.id, type: 'team' })}
                >
                  Message
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Search;
