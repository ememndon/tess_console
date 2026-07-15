"use client";

import { useEffect } from "react";

// Registers the service worker so the console is installable (PWA).
// The SW only caches immutable static assets — see public/sw.js.
export function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}
