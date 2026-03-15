import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const dbId = firebaseConfig.firestoreDatabaseId === "(default)" ? undefined : firebaseConfig.firestoreDatabaseId;
export const db = getFirestore(app, dbId);
