'use client'
import { useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { UserContext } from '../lib/context'; // Adjust path as needed
import styles from './sidebar.module.css';

const Sidebar = () => {
  const { user, userData } = useContext(UserContext); // Accessing user and userData from context
  const [teamNumber, setTeamNumber] = useState(userData?.teamNumber);
  const prevUserDataRef = useRef(userData);

  useEffect(() => {
    if (prevUserDataRef.current !== userData) {
      console.log("User data in Sidebar:", userData);
      prevUserDataRef.current = userData;
      setTeamNumber(userData?.teamNumber);
    }
  }, [userData]);

  return (
    <div className={styles.sidebar}>
      <nav>
        <ul>
          <li><Link href="/datadash">Data Dashboard</Link></li>
          <li><Link href="/scout">Scout Helper</Link></li>
          <li><Link href="/calendar">Calendar</Link></li>
          <li><Link href="/resources">Resources</Link></li>
          <li>
            {teamNumber ? (
              <Link href={`/team/${teamNumber}`}>Your Team</Link>
            ) : (
              <Link href="/team">Your Team</Link> 
            )}
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Sidebar;
