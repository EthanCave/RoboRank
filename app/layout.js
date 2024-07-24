// app/layout.js (or RootLayout.js)
import { Inter } from "next/font/google";
import "./ui/globals.css";
import Sidebar from "./components/sidebar";
import Navbar from "./components/Navbar";
import Footer from "./components/footer"; // Import the Footer component
import styles from "./components/Layout.module.css";
import { UserProvider } from "./lib/context"; // Adjust the import path as needed
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <UserProvider>
          <Navbar />
          <div className={styles.container}>
            <Sidebar />
            <div className={styles.content}>
              {children}
            </div>
          </div>
          <Footer /> {/* Add Footer here */}
          <Toaster />
        </UserProvider>
      </body>
    </html>
  );
}
