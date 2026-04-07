import type {
  BetterAuthClientPlugin,
  ClientFetchOption,
  ClientStore,
} from '@better-auth/core';
import { safeJSONParse } from '@better-auth/core/utils/json';
import {
  parseSetCookieHeader,
  SECURE_COOKIE_PREFIX,
  stripSecureCookiePrefix,
} from 'better-auth/cookies';
import { Platform } from 'react-native';
import { setupReactNativeFocusManager } from './focus-manager';
import { setupReactNativeOnlineManager } from './online-manager';
import { PACKAGE_VERSION } from './version';

if (Platform.OS !== 'web') {
  setupReactNativeFocusManager();
  setupReactNativeOnlineManager();
}

/**
 * Options for the React Native browser used during OAuth flows.
 * Passed directly to `react-native-inappbrowser-reborn`'s `InAppBrowser.openAuth`.
 */
export interface ReactNativeBrowserOptions {
  /** iOS: Use an ephemeral session (no shared cookies with Safari). */
  preferEphemeralSession?: boolean | undefined;
  /** Android: Show the title in the browser toolbar. */
  showTitle?: boolean | undefined;
  /** Android: Hide the URL bar. */
  enableUrlBarHiding?: boolean | undefined;
  /** Android: Disable the default share menu in the browser. */
  enableDefaultShare?: boolean | undefined;
  /** Android: Show loading dialog. */
  showInRecents?: boolean | undefined;
  /** Android: Animation for opening the browser. */
  animations?:
    | {
        startEnter?: string;
        startExit?: string;
        endEnter?: string;
        endExit?: string;
      }
    | undefined;
  /** Android: Custom color for the browser toolbar. */
  toolbarColor?: string | undefined;
  /** Android: Enable instant apps. */
  enableInstantApps?: boolean | undefined;
}

interface ReactNativeClientOptions {
  /**
   * Your app's deep link scheme (e.g. "myapp").
   * Required for OAuth flows on native platforms.
   * Must match the scheme declared in your AndroidManifest.xml / Info.plist.
   *
   * @example "myapp"
   */
  scheme: string;
  storage: {
    setItem: (key: string, value: string) => any;
    getItem: (key: string) => string | null;
  };
  /**
   * Prefix for local storage keys (e.g., "my-app_cookie", "my-app_session_data")
   * @default "better-auth"
   */
  storagePrefix?: string | undefined;
  /**
   * Prefix(es) for server cookie names to filter (e.g., "better-auth.session_token")
   * This is used to identify which cookies belong to better-auth to prevent
   * infinite refetching when third-party cookies are set.
   * Can be a single string or an array of strings to match multiple prefixes.
   * @default "better-auth"
   */
  cookiePrefix?: string | string[] | undefined;
  disableCache?: boolean | undefined;
  /**
   * Options to customize the in-app browser behavior when opening authentication
   * sessions. These are passed directly to `react-native-inappbrowser-reborn`'s
   * `InAppBrowser.openAuth`.
   *
   * @example
   * ```ts
   * const client = createClient({
   *   reactNative: {
   *     browserOptions: {
   *       preferEphemeralSession: true, // iOS: no shared cookies with Safari
   *     },
   *   },
   * });
   * ```
   */
  browserOptions?: ReactNativeBrowserOptions | undefined;
}

interface StoredCookie {
  value: string;
  expires: string | null;
}

export function getSetCookie(header: string, prevCookie?: string | undefined) {
  const parsed = parseSetCookieHeader(header);
  const toSetCookie =
    safeJSONParse<Record<string, StoredCookie>>(prevCookie) ?? {};
  parsed.forEach((cookie, key) => {
    const expiresAt = cookie['expires'];
    const maxAge = cookie['max-age'];
    if (maxAge !== undefined && Number(maxAge) <= 0) {
      delete toSetCookie[key];
      return;
    }
    const expires = maxAge
      ? new Date(Date.now() + Number(maxAge) * 1000)
      : expiresAt
        ? new Date(String(expiresAt))
        : null;
    if (expires && expires.getTime() <= Date.now()) {
      delete toSetCookie[key];
      return;
    }
    toSetCookie[key] = {
      value: cookie['value'],
      expires: expires ? expires.toISOString() : null,
    };
  });
  return JSON.stringify(toSetCookie);
}

export function getCookie(cookie: string) {
  let parsed = {} as Record<string, StoredCookie>;
  try {
    parsed = JSON.parse(cookie) as Record<string, StoredCookie>;
  } catch {}
  const toSend = Object.entries(parsed).reduce((acc, [key, value]) => {
    if (value.expires && new Date(value.expires) < new Date()) {
      return acc;
    }
    return acc ? `${acc}; ${key}=${value.value}` : `${key}=${value.value}`;
  }, '');
  return toSend;
}

function getOAuthStateValue(
  cookieJson: string | null,
  cookiePrefix: string | string[]
): string | null {
  if (!cookieJson) return null;

  const parsed = safeJSONParse<Record<string, StoredCookie>>(cookieJson);
  if (!parsed) return null;

  const prefixes = Array.isArray(cookiePrefix) ? cookiePrefix : [cookiePrefix];

  for (const prefix of prefixes) {
    const candidates = [
      `${SECURE_COOKIE_PREFIX}${prefix}.oauth_state`,
      `${prefix}.oauth_state`,
    ];

    for (const name of candidates) {
      const value = parsed?.[name]?.value;
      if (value) return value;
    }
  }

  return null;
}

/**
 * Build a deep link URL from a scheme and a path.
 * Mirrors the behaviour of `expo-linking`'s `createURL`.
 *
 * @param scheme  - e.g. "myapp"
 * @param path    - e.g. "/callback/google"
 * @returns       - e.g. "myapp:///callback/google"
 */
function createDeepLinkURL(scheme: string, path: string): string {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `${scheme}:/${safePath}`;
}

/**
 * Returns the origin for the given scheme, used as the `rn-origin` header.
 */
function getOrigin(scheme: string): string {
  return `${scheme}://`;
}

/**
 * Compare if session cookies have actually changed by comparing their values.
 * Ignores expiry timestamps that naturally change on each request.
 */
function hasSessionCookieChanged(
  prevCookie: string | null,
  newCookie: string
): boolean {
  if (!prevCookie) return true;

  try {
    const prev = JSON.parse(prevCookie) as Record<string, StoredCookie>;
    const next = JSON.parse(newCookie) as Record<string, StoredCookie>;

    const sessionKeys = new Set<string>();
    Object.keys(prev).forEach((key) => {
      if (key.includes('session_token') || key.includes('session_data')) {
        sessionKeys.add(key);
      }
    });
    Object.keys(next).forEach((key) => {
      if (key.includes('session_token') || key.includes('session_data')) {
        sessionKeys.add(key);
      }
    });

    for (const key of sessionKeys) {
      const prevValue = prev[key]?.value;
      const nextValue = next[key]?.value;
      if (prevValue !== nextValue) {
        return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Check if the Set-Cookie header contains better-auth cookies.
 * Prevents infinite refetching when non-better-auth cookies (e.g. CDN cookies) change.
 */
export function hasBetterAuthCookies(
  setCookieHeader: string,
  cookiePrefix: string | string[]
): boolean {
  const cookies = parseSetCookieHeader(setCookieHeader);
  const cookieSuffixes = ['session_token', 'session_data'];
  const prefixes = Array.isArray(cookiePrefix) ? cookiePrefix : [cookiePrefix];

  for (const name of cookies.keys()) {
    const nameWithoutSecure = stripSecureCookiePrefix(name);

    for (const prefix of prefixes) {
      if (prefix) {
        if (nameWithoutSecure.startsWith(prefix)) {
          return true;
        }
      } else {
        for (const suffix of cookieSuffixes) {
          if (nameWithoutSecure.endsWith(suffix)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * React Native secure storage does not support colons in keys.
 * This function replaces colons with underscores.
 */
export function normalizeCookieName(name: string) {
  return name.replace(/:/g, '_');
}

export function storageAdapter(storage: {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
}) {
  return {
    getItem: (name: string) => {
      return storage.getItem(normalizeCookieName(name));
    },
    setItem: (name: string, value: string) => {
      return storage.setItem(normalizeCookieName(name), value);
    },
  };
}

export const reactNativeClient = (opts: ReactNativeClientOptions) => {
  let store: ClientStore | null = null;
  const storagePrefix = opts?.storagePrefix || 'better-auth';
  const cookieName = `${storagePrefix}_cookie`;
  const localCacheName = `${storagePrefix}_session_data`;
  const storage = storageAdapter(opts?.storage);
  const isWeb = Platform.OS === 'web';
  const cookiePrefix = opts?.cookiePrefix || 'better-auth';

  const scheme = opts.scheme;

  if (!scheme && !isWeb) {
    throw new Error(
      'A "scheme" option is required in reactNativeClient. ' +
        'It must match the deep link scheme declared in your AndroidManifest.xml / Info.plist ' +
        '(e.g. scheme: "myapp").'
    );
  }

  return {
    id: 'react-native',
    version: PACKAGE_VERSION,
    getActions(_, $store) {
      store = $store;
      return {
        /**
         * Get the stored cookie string.
         *
         * Use this to attach auth cookies to custom fetch requests:
         *
         * @example
         * ```ts
         * const cookie = client.getCookie();
         * fetch("https://api.example.com", {
         *   headers: { cookie },
         * });
         * ```
         */
        getCookie: () => {
          const cookie = storage.getItem(cookieName);
          return getCookie(cookie || '{}');
        },
      };
    },
    fetchPlugins: [
      {
        id: 'react-native',
        name: 'React Native',
        hooks: {
          async onSuccess(context) {
            if (isWeb) return;
            const setCookie = context.response.headers.get('set-cookie');
            if (setCookie) {
              if (hasBetterAuthCookies(setCookie, cookiePrefix)) {
                const prevCookie = storage.getItem(cookieName);
                const toSetCookie = getSetCookie(
                  setCookie || '',
                  prevCookie ?? undefined
                );
                if (hasSessionCookieChanged(prevCookie, toSetCookie)) {
                  storage.setItem(cookieName, toSetCookie);
                  store?.notify('$sessionSignal');
                } else {
                  storage.setItem(cookieName, toSetCookie);
                }
              }
            }

            if (
              context.request.url.toString().includes('/get-session') &&
              !opts?.disableCache
            ) {
              const data = context.data;
              storage.setItem(localCacheName, JSON.stringify(data));
            }

            if (
              context.data?.redirect &&
              (context.request.url.toString().includes('/sign-in') ||
                context.request.url.toString().includes('/link-social')) &&
              !context.request?.body.includes('idToken')
            ) {
              const callbackURL = JSON.parse(context.request.body)?.callbackURL;
              const to = callbackURL;
              const signInURL = context.data?.url;

              let InAppBrowser:
                | typeof import('react-native-inappbrowser-reborn').default
                | undefined = undefined;
              try {
                InAppBrowser = (
                  await import('react-native-inappbrowser-reborn')
                ).default;
              } catch {
                try {
                  InAppBrowser =
                    require('react-native-inappbrowser-reborn').default;
                } catch (error) {
                  throw new Error(
                    '"react-native-inappbrowser-reborn" is not installed. ' +
                      'Please add it to your project:\n' +
                      '  npm install react-native-inappbrowser-reborn\n' +
                      '  cd ios && pod install',
                    { cause: error }
                  );
                }
              }

              if (Platform.OS === 'android') {
                try {
                  InAppBrowser!.closeAuth();
                } catch {}
              }

              const storedCookieJson = storage.getItem(cookieName);
              const oauthStateValue = getOAuthStateValue(
                storedCookieJson,
                cookiePrefix
              );
              const params = new URLSearchParams({
                authorizationURL: signInURL,
              });
              if (oauthStateValue) {
                params.append('oauthState', oauthStateValue);
              }
              const proxyURL = `${context.request.baseURL}/rn-authorization-proxy?${params.toString()}`;
              const result = await InAppBrowser!.openAuth(
                proxyURL,
                to,
                opts?.browserOptions
              );
              if (result.type !== 'success') return;
              const url = new URL(result.url);
              const cookie = url.searchParams.get('cookie');
              if (!cookie) return;
              const prevCookie = storage.getItem(cookieName);
              const toSetCookie = getSetCookie(cookie, prevCookie ?? undefined);
              storage.setItem(cookieName, toSetCookie);
              store?.notify('$sessionSignal');
            }
          },
        },
        async init(url, options) {
          if (isWeb) {
            return {
              url,
              options: options as ClientFetchOption,
            };
          }
          options = options || {};
          options.credentials = 'omit';

          /**
           * ID token flow (native sign-in) doesn't need cookie-based auth.
           * The ID token is cryptographically signed and validated server-side.
           */
          const isIdTokenRequest = options.body?.idToken !== undefined;

          if (isIdTokenRequest) {
            options.headers = {
              ...options.headers,
              'x-skip-oauth-proxy': 'true',
            };
          } else {
            const storedCookie = storage.getItem(cookieName);
            const cookie = getCookie(storedCookie || '{}');
            options.headers = {
              ...options.headers,
              ...(cookie ? { cookie } : {}),
              'rn-origin': getOrigin(scheme),
              'x-skip-oauth-proxy': 'true',
            };
            if (options.body?.callbackURL) {
              if (options.body.callbackURL.startsWith('/')) {
                options.body.callbackURL = createDeepLinkURL(
                  scheme,
                  options.body.callbackURL
                );
              }
            }
            if (options.body?.newUserCallbackURL) {
              if (options.body.newUserCallbackURL.startsWith('/')) {
                options.body.newUserCallbackURL = createDeepLinkURL(
                  scheme,
                  options.body.newUserCallbackURL
                );
              }
            }
            if (options.body?.errorCallbackURL) {
              if (options.body.errorCallbackURL.startsWith('/')) {
                options.body.errorCallbackURL = createDeepLinkURL(
                  scheme,
                  options.body.errorCallbackURL
                );
              }
            }
            if (url.includes('/sign-out')) {
              storage.setItem(cookieName, '{}');
              store?.atoms.session?.set({
                ...store.atoms.session.get(),
                data: null,
                error: null,
                isPending: false,
              });
              storage.setItem(localCacheName, '{}');
            }
          }
          return {
            url,
            options: options as ClientFetchOption,
          };
        },
      },
    ],
  } satisfies BetterAuthClientPlugin;
};

export { parseSetCookieHeader } from 'better-auth/cookies';
export * from './focus-manager';
export * from './online-manager';
