// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
	apiKey: "AIzaSyAWs0XHCSa-WkauqOJHUJayibrJNfm3TcQ",
	authDomain: "tourettic-text.firebaseapp.com",
	projectId: "tourettic-text",
	storageBucket: "tourettic-text.firebasestorage.app",
	messagingSenderId: "691904965707",
	appId: "1:691904965707:web:869568255d5f8a5b7a31ce",
	measurementId: "G-KGEKQH5424",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
analytics;
