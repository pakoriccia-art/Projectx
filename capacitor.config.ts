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
      // smallIcon/sound custom RIMOSSI: erano risorse native (drawable + raw)
      // assenti in un `cap add android` fresco → notifica senza icona / crash.
      // Con solo iconColor si usa l'icona di default dell'app e il suono di
      // sistema. Per notifiche brandizzate vedi docs/BUILD_ANDROID.md.
      iconColor: '#ff8c32'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;
