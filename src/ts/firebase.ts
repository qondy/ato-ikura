import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyC70sohdaXkwAc5k8LuwW2ztOd0Rnmk-XE',
  authDomain: 'ato-ikura.firebaseapp.com',
  projectId: 'ato-ikura',
  storageBucket: 'ato-ikura.firebasestorage.app',
  messagingSenderId: '1064592202750',
  appId: '1:1064592202750:web:5bc21911b9c1a04e363eaf',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
