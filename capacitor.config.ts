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
    // webContentsDebuggingEnabled non impostato: Capacitor lo abilita solo nelle
    // build di debug (npx cap run), spento in release. Serve a scripts/test-telefono.
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
