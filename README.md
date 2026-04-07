# better-auth-react-native

Better Auth integration for **bare React Native** (React Native CLI) applications.

> If you are using Expo, use [`@better-auth/expo`](https://www.npmjs.com/package/@better-auth/expo) instead.

## Installation

```sh
npm install better-auth-react-native react-native-inappbrowser-reborn @react-native-community/netinfo
# or
yarn add better-auth-react-native react-native-inappbrowser-reborn @react-native-community/netinfo
```

### iOS – link native modules

```sh
cd ios && pod install
```

### Android

No extra steps required for `@react-native-community/netinfo`.

For `react-native-inappbrowser-reborn`, follow its [installation guide](https://github.com/proyecto26/react-native-inappbrowser#android) if you are on React Native < 0.73.

---

## Prerequisites

### Deep link scheme

Register a custom URI scheme in your app so that the OAuth browser can redirect back to it.

**Android** – `android/app/src/main/AndroidManifest.xml`

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="myapp" />
</intent-filter>
```

**iOS** – `ios/<AppName>/Info.plist`

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>myapp</string>
    </array>
  </dict>
</array>
```

---

## Server setup

Add the `reactNative` server plugin to your Better Auth instance:

```ts
// auth.ts (server)
import { betterAuth } from 'better-auth';
import { reactNative } from 'better-auth-react-native';

export const auth = betterAuth({
  // ...
  plugins: [reactNative()],
});
```

### Plugin options

| Option                  | Type      | Default | Description                                                            |
| ----------------------- | --------- | ------- | ---------------------------------------------------------------------- |
| `disableOriginOverride` | `boolean` | `false` | Disable the automatic origin header rewrite for React Native requests. |

---

## Client setup

```ts
// auth-client.ts
import { createAuthClient } from 'better-auth/client';
import { reactNativeClient } from 'better-auth-react-native/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const client = createAuthClient({
  baseURL: 'https://your-api.example.com',
  plugins: [
    reactNativeClient({
      scheme: 'myapp', // must match your AndroidManifest / Info.plist scheme
      storage: AsyncStorage,
    }),
  ],
});
```

### Client options

| Option           | Type                        | Default         | Description                                                       |
| ---------------- | --------------------------- | --------------- | ----------------------------------------------------------------- |
| `scheme`         | `string`                    | **required**    | Your app's deep link scheme (e.g. `"myapp"`).                     |
| `storage`        | `{ getItem, setItem }`      | **required**    | Storage adapter. Use `@react-native-async-storage/async-storage`. |
| `storagePrefix`  | `string`                    | `"better-auth"` | Prefix for storage keys.                                          |
| `cookiePrefix`   | `string \| string[]`        | `"better-auth"` | Cookie prefix(es) used to identify better-auth cookies.           |
| `disableCache`   | `boolean`                   | `false`         | Disable session caching in storage.                               |
| `browserOptions` | `ReactNativeBrowserOptions` | `undefined`     | Options forwarded to `react-native-inappbrowser-reborn`.          |

### Getting the stored cookie (for custom fetch calls)

```ts
const cookie = client.getCookie();
fetch('https://your-api.example.com/custom-endpoint', {
  headers: { cookie },
});
```

---

## OAuth / Social sign-in

The OAuth flow is handled automatically. The client opens an in-app browser using `react-native-inappbrowser-reborn` and listens for the deep link callback.

```ts
// Trigger Google sign-in
await client.signIn.social({ provider: 'google', callbackURL: '/dashboard' });
```

### Ephemeral sessions (iOS)

To prevent the OAuth session from sharing cookies with Safari:

```ts
reactNativeClient({
  scheme: "myapp",
  storage: AsyncStorage,
  browserOptions: {
    preferEphemeralSession: true,
  },
}),
```

---

## Plugins

### `lastLoginMethodClient`

Tracks the last authentication method used, stored persistently.

```ts
import { lastLoginMethodClient } from "better-auth-react-native/plugins";
import AsyncStorage from "@react-native-async-storage/async-storage";

reactNativeClient({
  scheme: "myapp",
  storage: AsyncStorage,
}),
lastLoginMethodClient({
  storage: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    deleteItemAsync: (key) => AsyncStorage.removeItem(key),
  },
}),
```

Then use it:

```ts
const method = client.getLastUsedLoginMethod(); // "email" | "google" | ...
await client.clearLastUsedLoginMethod();
const isEmail = client.isLastUsedLoginMethod('email');
```

---

## Differences from `@better-auth/expo`

| Feature            | `@better-auth/expo`         | `better-auth-react-native`            |
| ------------------ | --------------------------- | ------------------------------------- |
| Scheme detection   | Auto via `expo-constants`   | Manual via `scheme` option (required) |
| URL building       | `expo-linking`              | Built-in (no extra dependency)        |
| Network monitoring | `expo-network`              | `@react-native-community/netinfo`     |
| OAuth browser      | `expo-web-browser`          | `react-native-inappbrowser-reborn`    |
| Origin header      | `expo-origin`               | `rn-origin`                           |
| Server proxy route | `/expo-authorization-proxy` | `/rn-authorization-proxy`             |

---

## License

MIT
