import React from 'react';
import ReactDOM from 'react-dom/client';
import { SessionGate } from '@northline/ui';
import { VesselOpsApp } from './VesselOpsApp';
import { defaultDevToken, getAuthConfig, getSession } from './lib/api';
import './styles.css';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => typeof value === "string" && value.length > 0);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionGate
      appName="Northline Vessel Ops"
      defaultDevToken={import.meta.env.DEV ? defaultDevToken : undefined}
      firebaseConfig={hasFirebaseConfig ? firebaseConfig : undefined}
      getAuthConfig={getAuthConfig}
      getSession={getSession}
    >
      <VesselOpsApp />
    </SessionGate>
  </React.StrictMode>
);
