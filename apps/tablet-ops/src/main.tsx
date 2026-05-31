import React from 'react';
import ReactDOM from 'react-dom/client';
import { SessionGate } from '@northline/ui';
import { VesselOpsApp } from './VesselOpsApp';
import { defaultDevToken, getAuthConfig, getSession } from './lib/api';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionGate
      appName="Northline Vessel Ops"
      defaultDevToken={import.meta.env.DEV ? defaultDevToken : undefined}
      getAuthConfig={getAuthConfig}
      getSession={getSession}
    >
      <VesselOpsApp />
    </SessionGate>
  </React.StrictMode>
);
