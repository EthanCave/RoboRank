"use client";

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { auth, firestore } from '../../lib/firebase';
import { arrayUnion, doc, updateDoc, getDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
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
      const teamRef = doc(firestore, `teams/${teamid}`);
      const teamDoc = await getDoc(teamRef);
      if (teamDoc.exists()) {
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
        const isUserMember = teamData.members?.some(member => member.uid === userUid);
        setIsMember(isUserMember);
        if (isUserMember) {
          console.log("User is a member of the team.");
          fetchJoinRequests(teamid);
        } else {
          console.log("User is not a member of the team.");
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
  }, 800), [user, router]);

  // Debounced function to fetch join requests
  const fetchJoinRequests = useCallback(debounce(async (teamid) => {
    if (!teamid) return;

    try {
      console.log("Fetching join requests for teamid:", teamid);
      const requestsRef = collection(firestore, `teams/${teamid}/requests`);
      const requestsSnapshot = await getDocs(requestsRef);
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
            members: arrayUnion({ uid: requestData.uid, role: 'member' }) // Add user to team members with a role
          });
          
          // Update the user's teamNumber field
          const userRef = doc(firestore, `users/${requestData.uid}`);
          await updateDoc(userRef, {
            teamNumber: teamid // Set the user's team number
          });
  
          // Delete the request
          await deleteDoc(requestRef);
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
      <div className={styles.contentWrapper}>
        <div className={styles.teamDetailsContainer}>
          {activeTab === 'details' && <TeamDetails teamData={teamData} />}
        </div>
        {activeTab === 'details' && <div className={styles.membersContainer}><MemberList members={teamData?.members} /></div>}
        {activeTab === 'requests' && isMember && <JoinRequests requests={requests} onAction={handleRequestAction} />}
      </div>
    </div>
  );
}

function TeamDetails({ teamData }) {
  return (
    <div className={styles.teamDetails}>
      <div className={styles.teamHeader}>
        <h1 className={styles.teamName}>{teamData?.name}</h1>
        <p className={styles.teamNumber}>Team Number: {teamData?.teamNumber}</p>
      </div>
      <div className={styles.detailsList}>
        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>Created by:</span>
          <span className={styles.detailValue}>{teamData?.createdBy}</span>
        </div>
        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>Grade:</span>
          <span className={styles.detailValue}>{teamData?.grade}</span>
        </div>
        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>City:</span>
          <span className={styles.detailValue}>{teamData?.city}</span>
        </div>
        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>Country:</span>
          <span className={styles.detailValue}>{teamData?.country}</span>
        </div>
        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>Organization:</span>
          <span className={styles.detailValue}>{teamData?.organization}</span>
        </div>
        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>Region:</span>
          <span className={styles.detailValue}>{teamData?.region}</span>
        </div>
        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>Robot Name:</span>
          <span className={styles.detailValue}>{teamData?.robotName || 'N/A'}</span>
        </div>
      </div>
    </div>
  );
}

function MemberList({ members }) {
  return (
    <div className={styles.memberListContainer}>
      <h2 className={styles.membersHeader}>Members</h2>
      <ul className={styles.memberList}>
        {members?.map((member, index) => (
          <li key={index} className={styles.memberItem}>
            <img className={styles.memberPhoto} src={member.photoURL} alt={member.displayName} />
            <div className={styles.memberInfo}>
              <span className={styles.memberName}>{member.displayName}</span>
              <span className={styles.memberUsername}>Username: {member.username}</span>
              <span className={styles.memberRole}>Role: {member.role || 'N/A'}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JoinRequests({ requests, onAction }) {
    return (
        <div className={styles.requestsContainer}>
            <h2 className={styles.requestsHeader}>Pending Join Requests</h2>
            <ul className={styles.requestList}>
                {requests.length > 0 ? (
                    requests.map(request => (
                        <li key={request.id} className={styles.requestItem}>
                            <span className={styles.requestUsername}>{request.username}</span>
                            <div>
                                <button className={styles.buttonAccept} onClick={() => onAction(request.id, 'accept')}>✓</button>
                                <button className={styles.buttonReject} onClick={() => onAction(request.id, 'reject')}>✗</button>
                            </div>
                        </li>
                    ))
                ) : (
                    <p>No pending requests</p>
                )}
            </ul>
        </div>
    );
}
