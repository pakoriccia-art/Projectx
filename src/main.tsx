import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Capacitor: inizializza i plugin nativi quando la piattaforma è pronta
// In WebView Android, 'deviceready' non è necessario con Capacitor 6+
// (a differenza di Cordova). Il DOM è già pronto qui.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
