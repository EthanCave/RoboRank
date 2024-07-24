"use client";

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { auth, firestore, storage } from '../../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuthState } from 'react-firebase-hooks/auth';

const UserProfile = () => {
  const { username } = useParams();
  const [userProfile, setUserProfile] = useState(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [user] = useAuthState(auth); // Get the current user

  useEffect(() => {
    if (username) {
      const fetchUserProfile = async () => {
        try {
          const userDoc = firestore.collection('users').where('username', '==', username).limit(1);
          const querySnapshot = await userDoc.get();
          if (!querySnapshot.empty) {
            const userData = querySnapshot.docs[0].data();
            setUserProfile(userData);
          } else {
            console.log('User not found');
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      };

      fetchUserProfile();
    }
  }, [username]);

  const handleFileChange = (e) => {
    if (e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (file && userProfile) {
      setUploading(true);
      const storageRef = ref(storage, `profilePictures/${username}/${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          // Handle progress if needed
        },
        (error) => {
          console.error('Upload failed:', error);
          setUploading(false);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          await firestore.doc(`users/${userProfile.username}`).update({
            photoURL: downloadURL,
          });
          setUserProfile((prev) => ({ ...prev, photoURL: downloadURL }));
          setFile(null);
          setUploading(false);
        }
      );
    }
  };

  if (!userProfile) return <div>Loading...</div>;

  return (
    <div>
      <h1>{userProfile.displayName}'s Profile</h1>
      <img
        src={userProfile.photoURL || '/default-profile.png'}
        alt="Profile"
        style={{ width: '150px', height: '150px', borderRadius: '50%' }}
      />
      <p>Username: {userProfile.username}</p>
      {userProfile.username === user?.displayName && (
        <div>
          <input type="file" onChange={handleFileChange} />
          <button onClick={handleUpload} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload Picture'}
          </button>
        </div>
      )}
    </div>
  );
};

export default UserProfile;
