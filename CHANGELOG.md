# better-auth-react-native

## 1.0.0

### Major Changes

- Initial release of `better-auth-react-native` — Better Auth integration for bare React Native (React Native CLI) applications.
  - `reactNative()` server plugin to handle origin override and OAuth callbacks
  - `reactNativeClient()` client plugin with cookie management, session caching, and OAuth flow via `react-native-inappbrowser-reborn`
  - `lastLoginMethodClient()` plugin for persisting the last-used authentication method
  - Network monitoring via `@react-native-community/netinfo`
  - App focus management via React Native `AppState`
