"use client";

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { auth, firestore } from '../../lib/firebase';
import { arrayUnion, doc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import debounce from 'lodash.debounce';
import styles from './Team.module.css';
import { useAuthState } from 'react-firebase-hooks/auth';

export default function TeamPage() {
  const router = useRouter();
  const pathname = usePathname(); // Get the current path
  const [user] = useAuthState(auth);
  const [teamData, setTeamData] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);
  const [activeTab, setActiveTab] = useState('details');

  // Extract teamid from pathname
  const teamid = pathname.split('/').pop(); // Assumes URL format is /team/[teamid]

  // Debounced function to fetch team data
  const fetchTeamData = useCallback(debounce(async (teamid) => {
    if (!teamid) return;

    setLoading(true);
    try {
      console.log("Fetching team data for teamid:", teamid);
      const teamRef = firestore.doc(`teams/${teamid}`);
      const teamDoc = await teamRef.get();
      if (teamDoc.exists) {
        const teamData = teamDoc.data();
        setTeamData(teamData);
        console.log("Team data fetched:", teamData);
        
        // Ensure user is available
        if (!user) {
          console.warn("User not logged in.");
          setLoading(false);
          return;
        }

        const userUid = user.uid; // Correctly access user UID
        console.log("User UID:", userUid);
        console.log("Team members:", teamData.members);

        // Check if the user is a member of the team
        if (teamData.members?.includes(userUid)) {
          console.log("User is a member of the team.");
          setIsMember(true);
          fetchJoinRequests(teamid);
        } else {
          console.log("User is not a member of the team.");
          setIsMember(false);
        }
      } else {
        console.warn("Team not found. Redirecting to home.");
        router.push('/');
      }
    } catch (error) {
      console.error("Error fetching team data:", error);
    } finally {
      setLoading(false);
    }
  }, 800), [user]);

  // Debounced function to fetch join requests
  const fetchJoinRequests = useCallback(debounce(async (teamid) => {
    if (!teamid) return;

    try {
      console.log("Fetching join requests for teamid:", teamid);
      const requestsRef = firestore.collection(`teams/${teamid}/requests`);
      const requestsSnapshot = await requestsRef.get();
      const requestData = requestsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log("Join requests data:", requestData);
      setRequests(requestData);
    } catch (error) {
      console.error("Error fetching join requests:", error);
    }
  }, 800), []);

  useEffect(() => {
    if (teamid && user) {
      console.log("Fetching data for teamid:", teamid);
      fetchTeamData(teamid);
    } else {
      console.log("No teamid or user not available.");
      setLoading(false);
    }
  }, [teamid, user, fetchTeamData]);

  const handleRequestAction = async (requestId, action) => {
    if (!teamid || !user) return; // Ensure teamid and user are available
  
    try {
      const requestRef = doc(firestore, `teams/${teamid}/requests/${requestId}`);
      if (action === 'accept') {
        const requestDoc = await getDoc(requestRef); // Correctly use getDoc for Firestore v9+
        const requestData = requestDoc.data();
        if (requestData) {
          const teamRef = doc(firestore, `teams/${teamid}`);
          
          // Update the team members array
          await updateDoc(teamRef, {
            members: arrayUnion(requestData.uid) // Add user to team members
          });
          
          // Update the user's teamNumber field
          const userRef = doc(firestore, `users/${requestData.uid}`);
          await updateDoc(userRef, {
            teamNumber: teamid // Set the user's team number
          });
  
          // Delete the request
          await deleteDoc(requestRef)
        }
      } else if (action === 'reject') {
        await deleteDoc(requestRef);
      }
      
      // Fetch updated join requests
      fetchJoinRequests(teamid);
    } catch (error) {
      console.error(`Error processing request action (${action}):`, error);
    }
  };
  

  if (loading) return <div>Loading...</div>;

  return (
    <div className={styles.teamContainer}>
      <h1 className={styles.teamName}>{teamData?.name}</h1>
      <div className={styles.tabs}>
        <button onClick={() => setActiveTab('details')} className={activeTab === 'details' ? styles.active : ''}>
          Team Details
        </button>
        {isMember && (
          <button onClick={() => setActiveTab('requests')} className={activeTab === 'requests' ? styles.active : ''}>
            Join Requests
          </button>
        )}
      </div>
      <div className={styles.tabContent}>
        {activeTab === 'details' && <TeamDetails teamData={teamData} />}
        {activeTab === 'requests' && isMember && <JoinRequests requests={requests} onAction={handleRequestAction} />}
      </div>
    </div>
  );
}

function TeamDetails({ teamData }) {
  return (
    <div>
      <h2 className={styles.detailsHeader}>Team Details</h2>
      <p>Team Name: {teamData?.name}</p>
      <p>Team Number: {teamData?.teamNumber}</p>
      <p>Created by: {teamData?.createdBy}</p>
    </div>
  );
}

function JoinRequests({ requests, onAction }) {
  return (
    <div>
      <h2 className={styles.detailsHeader}>Pending Join Requests</h2>
      {requests.length > 0 ? (
        <ul>
          {requests.map(request => (
            <li key={request.id}>
              {request.username} ({request.uid})
              <button className={styles.accept} onClick={() => onAction(request.id, 'accept')}>Accept</button>
              <button className={styles.reject} onClick={() => onAction(request.id, 'reject')}>Reject</button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No pending requests</p>
      )}
    </div>
  );
}
