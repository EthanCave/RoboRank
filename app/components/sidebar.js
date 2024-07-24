import { useContext } from 'react';
import Link from 'next/link';
import { UserContext } from '../lib/context'; // Adjust path as needed
import styles from './sidebar.module.css';


const Sidebar = () => {
 // Ensure `useContext` is imported correctly

  // Use the user's team number if available
  
  return (
    <div className={styles.sidebar}>
      <nav>
        <ul>
          <li><Link href="/datadash">Data Dashboard</Link></li>
          <li><Link href="/scout">Scout Helper</Link></li>
          <li><Link href="/calendar">Calendar</Link></li>
          <li><Link href="/resources">Resources</Link></li>
          <li><Link href='/team'>Your Team</Link></li>
        </ul>
      </nav>
    </div>
  );
};

export default Sidebar;
