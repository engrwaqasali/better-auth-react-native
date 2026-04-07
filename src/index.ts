import type { BetterAuthPlugin } from '@better-auth/core';
import { createAuthMiddleware } from '@better-auth/core/api';
import { reactNativeAuthorizationProxy } from './routes';
import { PACKAGE_VERSION } from './version';

export interface ReactNativeOptions {
  /**
   * Disable origin override for React Native API routes.
   * When set to true, the origin header will not be overridden for React Native API routes.
   */
  disableOriginOverride?: boolean | undefined;
}

declare module '@better-auth/core' {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    reactNative: {
      creator: typeof reactNative;
    };
  }
}

export const reactNative = (options?: ReactNativeOptions | undefined) => {
  return {
    id: 'react-native',
    version: PACKAGE_VERSION,
    init: (ctx) => {
      const trustedOrigins =
        process.env.NODE_ENV === 'development' ? ['rn://'] : [];

      return {
        options: {
          trustedOrigins,
        },
      };
    },
    async onRequest(request, ctx) {
      if (options?.disableOriginOverride || request.headers.get('origin')) {
        return;
      }
      /**
       * To bypass the origin check from React Native, we read the
       * rn-origin header and set it as the request origin.
       */
      const rnOrigin = request.headers.get('rn-origin');
      if (!rnOrigin) {
        return;
      }

      try {
        // Prefer in-place mutation (works on Bun, Node, Deno).
        request.headers.set('origin', rnOrigin);
        return { request };
      } catch {
        // Cloudflare Workers has immutable headers on incoming requests,
        // so fall back to constructing a new Request.
        const newHeaders = new Headers(request.headers);
        newHeaders.set('origin', rnOrigin);
        return { request: new Request(request, { headers: newHeaders }) };
      }
    },
    hooks: {
      after: [
        {
          matcher(context) {
            return !!(
              context.path?.startsWith('/callback') ||
              context.path?.startsWith('/oauth2/callback') ||
              context.path?.startsWith('/magic-link/verify') ||
              context.path?.startsWith('/verify-email')
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const headers = ctx.context.responseHeaders;
            const location = headers?.get('location');
            if (!location) {
              return;
            }
            const isProxyURL = location.includes('/oauth-proxy-callback');
            if (isProxyURL) {
              return;
            }
            let redirectURL: URL;
            try {
              redirectURL = new URL(location);
            } catch {
              return;
            }
            const isHttpRedirect =
              redirectURL.protocol === 'http:' ||
              redirectURL.protocol === 'https:';
            if (isHttpRedirect) {
              return;
            }
            const isTrustedOrigin = ctx.context.isTrustedOrigin(location);
            if (!isTrustedOrigin) {
              return;
            }
            const cookie = headers?.get('set-cookie');
            if (!cookie) {
              return;
            }
            // Append the session cookie as a URL parameter so the client
            // can extract and store it after the deep link callback.
            redirectURL.searchParams.set('cookie', cookie);
            ctx.setHeader('location', redirectURL.toString());
          }),
        },
      ],
    },
    endpoints: {
      reactNativeAuthorizationProxy,
    },
    options,
  } satisfies BetterAuthPlugin;
};
