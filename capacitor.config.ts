import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pizzamatrix.app',
  appName: 'PizzaMatrix',
  webDir: 'dist',
  // Nessun server.url in produzione → WebView usa i file locali da dist/
  // Decommentare solo per sviluppo con live-reload:
  // server: { url: 'http://192.168.x.x:5173', cleartext: true },
  android: {
    allowMixedContent: false,
    // Permette WebView di usare IndexedDB (Dexie.js) senza limitazioni
    webContentsDebuggingEnabled: false
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#ff8c32',
      sound: 'beep.wav'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;
