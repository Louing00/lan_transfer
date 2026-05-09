import { createId } from "./id";

const deviceNameKey = "lindrop.deviceName";
let pageDeviceId: string | undefined;

export function getDeviceId() {
  const override = new URLSearchParams(window.location.search).get("deviceId");
  if (override) {
    return override.slice(0, 80);
  }

  if (!pageDeviceId) {
    pageDeviceId = createId("device");
  }
  return pageDeviceId;
}

export function getDeviceName() {
  const existing = localStorage.getItem(deviceNameKey);
  if (existing) {
    return existing;
  }

  const name = createDefaultDeviceName();
  localStorage.setItem(deviceNameKey, name);
  return name;
}

export function setDeviceName(name: string) {
  const cleaned = name.trim().slice(0, 48) || createDefaultDeviceName();
  localStorage.setItem(deviceNameKey, cleaned);
  return cleaned;
}

function createDefaultDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android 设备";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows 电脑";
  return "浏览器设备";
}
