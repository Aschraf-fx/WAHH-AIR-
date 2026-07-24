// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD1UH4J2jCBvnj_iZjJJGn8Cpr4M1gRdUc",
  authDomain: "wahh-air.firebaseapp.com",
  projectId: "wahh-air",
  storageBucket: "wahh-air.firebasestorage.app",
  messagingSenderId: "620924579524",
  appId: "1:620924579524:web:06a81eb69ae0ae41c92391",
  measurementId: "G-2E2T2X19V2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);