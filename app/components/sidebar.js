import Link from 'next/link';
import styles from './sidebar.module.css';

const Sidebar = () => {
  return (
    <div className={styles.sidebar}>
      <nav>
        <ul>
          <li><Link href="/datadash">Data Dashboard</Link></li>
          <li><Link href="/scout">Scout Helper</Link></li>
          <li><Link href="/calendar">Calendar</Link></li>
          <li><Link href="/resources">Resources</Link></li>
          <li><Link href="/team">Your Team</Link></li>
        </ul>
      </nav>
    </div>
  );
};

export default Sidebar;