import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
	apiKey: "AIzaSyBk-yCDgnqiUWzKF-GKsVAnFyq6vptlh1E",
	authDomain: "theperfectbark-6fa05.firebaseapp.com",
	projectId: "theperfectbark-6fa05",
	storageBucket: "theperfectbark-6fa05.firebasestorage.app",
	messagingSenderId: "494274968719",
	appId: "1:494274968719:web:2f5a6e1c917cbf378cc4fa",
	measurementId: "G-0TGPJ8D0C0",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
const analytics = getAnalytics(app);
analytics;
