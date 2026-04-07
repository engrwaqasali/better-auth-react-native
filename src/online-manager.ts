import type { OnlineListener, OnlineManager } from 'better-auth/client';
import { kOnlineManager } from 'better-auth/client';

class ReactNativeOnlineManager implements OnlineManager {
  listeners = new Set<OnlineListener>();
  isOnline = true;
  unsubscribe?: () => void;

  subscribe(listener: OnlineListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setOnline(online: boolean) {
    if (this.isOnline === online) return;
    this.isOnline = online;
    this.listeners.forEach((listener) => listener(online));
  }

  setup() {
    import('@react-native-community/netinfo')
      .then((NetInfo) => {
        const unsubscribe = NetInfo.addEventListener((state) => {
          this.setOnline(!!state.isInternetReachable);
        });
        this.unsubscribe = unsubscribe;
      })
      .catch(() => {
        // Fallback: assume always online if netinfo is not available
        this.setOnline(true);
      });

    return () => {
      this.unsubscribe?.();
    };
  }
}

export function setupReactNativeOnlineManager() {
  if (!(globalThis as any)[kOnlineManager]) {
    (globalThis as any)[kOnlineManager] = new ReactNativeOnlineManager();
  }
  return (globalThis as any)[kOnlineManager] as OnlineManager;
}
