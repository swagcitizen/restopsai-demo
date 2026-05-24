// nativeBridge.js — abstraction layer for native device APIs.
//
// All native calls in the staff PWA go through this file. The current
// implementations use standard web APIs (Geolocation, MediaStream, Vibration,
// Web Push). When wrapping with Capacitor for iOS/Android later, swap each
// WEB_IMPL block for the matching @capacitor/* plugin. Screens never change.
//
// Capacitor swap-in reference:
//   getCurrentPosition  → @capacitor/geolocation       Geolocation.getCurrentPosition
//   takePhoto           → @capacitor/camera            Camera.getPhoto({source: 'CAMERA'})
//   haptic              → @capacitor/haptics           Haptics.impact / Haptics.notification
//   registerPush        → @capacitor/push-notifications PushNotifications.register
//   getDeviceId         → @capacitor/device            Device.getId

const DEVICE_ID_KEY = 'stationly_staff_device_id';

// ----- Device ID --------------------------------------------------------------
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + '-' + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ----- Geolocation ------------------------------------------------------------
// WEB_IMPL: navigator.geolocation
// CAPACITOR: import { Geolocation } from '@capacitor/geolocation';
export async function getCurrentPosition({ timeoutMs = 12000 } = {}) {
  if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error('Location timed out')), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(tid);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          ts: pos.timestamp,
        });
      },
      (err) => { clearTimeout(tid); reject(err); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

// ----- Camera / selfie --------------------------------------------------------
// WEB_IMPL: hidden <input type="file" accept="image/*" capture="user">
// CAPACITOR: Camera.getPhoto({ source: CameraSource.Camera, direction: 'FRONT' })
export function takePhoto() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'user';   // hint: front camera on mobile
    input.style.display = 'none';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { reject(new Error('No photo')); return; }
      resolve({ blob: f, mime: f.type, name: f.name });
    };
    input.oncancel = () => reject(new Error('Cancelled'));
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 30000);
  });
}

// ----- Haptics ----------------------------------------------------------------
// WEB_IMPL: navigator.vibrate
// CAPACITOR: Haptics.impact({ style: ImpactStyle.Medium })
const PATTERNS = {
  tap: [10],
  success: [10, 40, 30],
  warn: [30, 30, 30],
  error: [50, 80, 50, 80, 50],
};
export function haptic(kind = 'tap') {
  if (!('vibrate' in navigator)) return;
  try { navigator.vibrate(PATTERNS[kind] || PATTERNS.tap); } catch {}
}

// ----- Network status ---------------------------------------------------------
export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}
export function onNetworkChange(cb) {
  const up = () => cb(true), down = () => cb(false);
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
}

// ----- Web Push ---------------------------------------------------------------
// WEB_IMPL: navigator.serviceWorker.pushManager.subscribe
// CAPACITOR: PushNotifications.register + PushNotifications.addListener('registration', ...)
export async function registerPush(vapidPublicKey) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if (!vapidPublicKey) return null;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  return sub.toJSON();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ----- Install prompt (PWA-only; Capacitor doesn't need this) -----------------
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
});
export function canPromptInstall() { return !!installEvent; }
export async function promptInstall() {
  if (!installEvent) return null;
  installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  return choice.outcome;
}
