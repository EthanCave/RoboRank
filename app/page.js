import styles from './page.module.css'; // Import CSS module


export default function Home() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Welcome to VexTeam Link</h1>
        <p>Your ultimate platform for team management and strategy.</p>
        <button className={styles.ctaButton}>Get Started</button>
      </header>
      <section className={styles.features}>
        <div className={styles.feature}>
          <h2>Team Management</h2>
          <p>Organize and manage your team activities efficiently.</p>
        </div>
        <div className={styles.feature}>
          <h2>Collaborative Strategy Planning</h2>
          <p>Plan strategies together with your team members.</p>
        </div>
        <div className={styles.feature}>
          <h2>Data Dashboard</h2>
          <p>Gain insights and analytics to make informed decisions.</p>
        </div>
      </section>

    </div>
    
  );
}
