import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration - Real config from your Firebase project
const firebaseConfig = {
  apiKey: "AIzaSyAyNVqZHZaRXvwGKIi--h1UAuiOAW9lrJ4",
  authDomain: "wedding-photo-240c9.firebaseapp.com",
  projectId: "wedding-photo-240c9",
  storageBucket: "wedding-photo-240c9.firebasestorage.app",
  messagingSenderId: "767610841427",
  appId: "1:767610841427:web:e78675ba1d30c4fe4e19a6",
  measurementId: "G-HRXH4LVZBS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
