"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { firestore, auth } from '../lib/firebase';
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  limit,  // Import limit function
} from 'firebase/firestore';
import styles from './Messages.module.css';

const Messages = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipientId = searchParams.get('recipientId');
  const [user, setUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      const chatsRef = collection(firestore, 'chats');
      const unsubscribe = onSnapshot(
        query(chatsRef, where('participants', 'array-contains', user.uid)),
        async (snapshot) => {
          const chatList = [];
          for (const chatDoc of snapshot.docs) {
            const chatData = chatDoc.data();
            const otherUserId = chatData.participants.find((id) => id !== user.uid);
            const userDoc = await getDoc(doc(firestore, 'users', otherUserId));
            if (userDoc.exists()) {
              chatList.push({ ...userDoc.data(), uid: otherUserId, chatId: chatDoc.id });
            }
          }
          setChats(chatList);
        }
      );
      return () => unsubscribe();
    }
  }, [user]);

  useEffect(() => {
    if (recipientId && user) {
      const fetchRecipient = async () => {
        const userDoc = await getDoc(doc(firestore, 'users', recipientId));
        if (userDoc.exists()) {
          const recipientData = userDoc.data();
          const chatDocs = await getDocs(
            query(collection(firestore, 'chats'), where('participants', 'array-contains', user.uid))
          );
          let chatId = null;
          chatDocs.forEach((chatDoc) => {
            const data = chatDoc.data();
            if (data.participants.includes(recipientId)) {
              chatId = chatDoc.id;
            }
          });
          if (chatId) {
            setSelectedUser({ ...recipientData, uid: recipientId, chatId });
          } else {
            const newChatRef = await addDoc(collection(firestore, 'chats'), {
              participants: [user.uid, recipientId],
              createdAt: serverTimestamp(),
            });
            setSelectedUser({ ...recipientData, uid: recipientId, chatId: newChatRef.id });
          }
        }
      };

      fetchRecipient();
    }
  }, [recipientId, user]);

  useEffect(() => {
    if (selectedUser && selectedUser.chatId) {
      setMessages([]); // Clear messages when a new user is selected
      const messagesRef1 = collection(firestore, `messages/${selectedUser.uid}/${user.uid}`);
      const messagesRef2 = collection(firestore, `messages/${user.uid}/${selectedUser.uid}`);
      const q1 = query(messagesRef1, orderBy('timestamp'));
      const q2 = query(messagesRef2, orderBy('timestamp'));

      const unsubscribe1 = onSnapshot(q1, (snapshot) => {
        const msgs1 = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
        setMessages((prevMsgs) => {
          const newMsgs = [...prevMsgs, ...msgs1];
          const uniqueMsgs = Array.from(new Set(newMsgs.map(msg => msg.id))).map(id => newMsgs.find(msg => msg.id === id));
          return uniqueMsgs.sort((a, b) => a.timestamp?.toDate() - b.timestamp?.toDate());
        });
      });

      const unsubscribe2 = onSnapshot(q2, (snapshot) => {
        const msgs2 = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
        setMessages((prevMsgs) => {
          const newMsgs = [...prevMsgs, ...msgs2];
          const uniqueMsgs = Array.from(new Set(newMsgs.map(msg => msg.id))).map(id => newMsgs.find(msg => msg.id === id));
          return uniqueMsgs.sort((a, b) => a.timestamp?.toDate() - b.timestamp?.toDate());
        });
      });

      return () => {
        unsubscribe1();
        unsubscribe2();
      };
    }
  }, [selectedUser]);

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (newMessage.trim() && selectedUser.uid) {
      const chatId = selectedUser.chatId || (await createChat());

      await addDoc(collection(firestore, `messages/${user.uid}/${selectedUser.uid}`), {
        chatId,
        senderId: user.uid,
        receiverId: selectedUser.uid,
        message: newMessage,
        timestamp: serverTimestamp(),
      });

      setNewMessage('');
    }
  };

  const createChat = async () => {
    const chatRef = await addDoc(collection(firestore, 'chats'), {
      participants: [user.uid, selectedUser.uid],
      createdAt: serverTimestamp(),
    });
    const chatId = chatRef.id;
    await updateDoc(chatRef, { chatId });
    setSelectedUser({ ...selectedUser, chatId });
    return chatId;
  };

  const fetchLastMessage = async (chat) => {
    const { uid: otherUserId } = chat;
    const lastMessageQuery = query(
      collection(firestore, `messages/${user.uid}/${otherUserId}`),
      orderBy('timestamp', 'desc'),
      limit(1)
    );
    const lastMessageSnapshot = await getDocs(lastMessageQuery);
    const lastMessage = lastMessageSnapshot.docs[0]?.data() || {};

    return { ...chat, lastMessage };
  };

  useEffect(() => {
    if (user) {
      const updateChatsWithLastMessage = async () => {
        const updatedChats = await Promise.all(chats.map(fetchLastMessage));
        updatedChats.sort((a, b) => (b.lastMessage.timestamp?.toDate() - a.lastMessage.timestamp?.toDate()));
        setChats(updatedChats);
      };

      updateChatsWithLastMessage();
    }
  }, [chats, user]);

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <h2>Chats</h2>
        {chats.map((chat, index) => (
          <div
            key={index}
            onClick={() => setSelectedUser(chat)}
            style={{ cursor: 'pointer', padding: '10px', borderBottom: '1px solid #ddd' }}
          >
            <img
              src={chat.photoURL || '/default-profile.png'}
              alt={chat.displayName}
              style={{ borderRadius: '50%', width: '40px', height: '40px' }}
            />
            <span>{chat.displayName}</span>
          </div>
        ))}
      </div>
      <div className={styles.chatArea}>
        {selectedUser ? (
          <>
            <div className={styles.chatHeader}>
              <img
                src={selectedUser.photoURL || '/default-profile.png'}
                alt={selectedUser.displayName}
                className={styles.profileImage}
              />
              <h3>{selectedUser.displayName}</h3>
            </div>
            <div className={styles.messagesList}>
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`${styles.message} ${msg.senderId === user.uid ? styles.sent : styles.received}`}
                >
                  <p>{msg.message}</p>
                  <span>{msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString() : 'Invalid date'}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendMessage} className={styles.inputContainer}>
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type your message"
                className={styles.inputField}
              />
              <button type="submit" className={styles.sendButton}>Send</button>
            </form>
          </>
        ) : (
          <p>Select a user to start chatting</p>
        )}
      </div>
    </div>
  );
};

export default Messages;
