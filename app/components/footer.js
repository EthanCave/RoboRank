// components/Footer.js
import styles from './Footer.module.css'; // Import CSS module for styling

const Footer = () => {
  return (
    <footer className={styles.footer}>
      <p>© {new Date().getFullYear()} VexTeamLink. All rights reserved.</p>
    </footer>
  );
};

export default Footer;
