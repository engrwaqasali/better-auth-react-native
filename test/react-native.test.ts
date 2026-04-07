import { createAuthMiddleware } from 'better-auth/api';
import { oAuthProxy } from 'better-auth/plugins';
import { getTestInstance } from 'better-auth/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { reactNative } from '../src';
import { reactNativeClient } from '../src/client';

vi.mock('react-native-inappbrowser-reborn', async () => {
  return {
    default: {
      closeAuth: vi.fn(),
      openAuth: vi.fn(async (...args: unknown[]) => {
        fn(...args);
        return {
          type: 'success',
          url: 'better-auth://?cookie=better-auth.session_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjYxMzQwZj',
        };
      }),
    },
  };
});

vi.mock('react-native', async () => {
  return {
    AppState: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    Platform: {
      OS: 'android',
    },
  };
});

const fn = vi.fn();

describe('react-native', async () => {
  const storage = new Map<string, string>();

  const { auth, client, testUser } = await getTestInstance(
    {
      emailAndPassword: {
        enabled: true,
      },
      socialProviders: {
        google: {
          clientId: 'test',
          clientSecret: 'test',
        },
      },
      plugins: [reactNative(), oAuthProxy()],
      trustedOrigins: ['better-auth://'],
    },
    {
      clientOptions: {
        plugins: [
          reactNativeClient({
            scheme: 'better-auth',
            storage: {
              getItem: (key) => storage.get(key) || null,
              setItem: async (key, value) => storage.set(key, value),
            },
          }),
        ],
      },
    }
  );

  beforeAll(async () => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('should store cookie with expires date', async () => {
    await client.signIn.email({
      email: testUser.email,
      password: testUser.password,
    });
    const storedCookie = storage.get('better-auth_cookie');
    expect(storedCookie).toBeDefined();
    const parsedCookie = JSON.parse(storedCookie || '');
    expect(parsedCookie['better-auth.session_token']).toMatchObject({
      value: expect.stringMatching(/.+/),
      expires: expect.any(String),
    });
  });

  it('should send cookie and get session', async () => {
    const { data } = await client.getSession();
    expect(data).toMatchObject({
      session: expect.any(Object),
      user: expect.any(Object),
    });
  });

  it('should use the scheme to open the browser', async () => {
    const { data: res } = await client.signIn.social({
      provider: 'google',
      callbackURL: '/dashboard',
    });
    const stateId = res?.url?.split('state=')[1]!.split('&')[0];
    const ctx = await auth.$context;
    if (!stateId) {
      throw new Error('State ID not found');
    }
    const state = await ctx.internalAdapter.findVerificationValue(stateId);
    const callbackURL = JSON.parse(state?.value || '{}').callbackURL;
    expect(callbackURL).toBe('better-auth://dashboard');
    expect(res).toMatchObject({
      url: expect.stringContaining('accounts.google'),
    });
    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining('accounts.google'),
      'better-auth://dashboard',
      undefined
    );
  });

  it('should pass browserOptions to openAuth', async () => {
    const { client } = await getTestInstance(
      {
        plugins: [reactNative()],
        trustedOrigins: ['better-auth://'],
        socialProviders: {
          google: {
            clientId: 'GOOGLE_CLIENT_ID',
            clientSecret: 'GOOGLE_CLIENT_SECRET',
          },
        },
      },
      {
        clientOptions: {
          plugins: [
            reactNativeClient({
              scheme: 'better-auth',
              storage: {
                getItem: (key) => storage.get(key) || null,
                setItem: async (key, value) => storage.set(key, value),
              },
              browserOptions: {
                preferEphemeralSession: true,
              },
            }),
          ],
        },
      }
    );
    await client.signIn.social({
      provider: 'google',
      callbackURL: '/dashboard',
    });
    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining('accounts.google'),
      'better-auth://dashboard',
      {
        preferEphemeralSession: true,
      }
    );
  });

  it('should get cookies', async () => {
    const c = client.getCookie();
    expect(c).includes('better-auth.session_token');
  });

  it('should remove expired cookies from store when Max-Age=0', async () => {
    const { getSetCookie } = await import('../src/client');
    const prevCookie = JSON.stringify({
      'better-auth.session_token': { value: 'abc123', expires: null },
      'better-auth.session_data': { value: 'xyz789', expires: null },
    });
    const header =
      'better-auth.session_token=; Max-Age=0, better-auth.session_data=; Max-Age=0';
    const result = JSON.parse(getSetCookie(header, prevCookie));
    expect(result['better-auth.session_token']).toBeUndefined();
    expect(result['better-auth.session_data']).toBeUndefined();
  });

  it('should remove cookies with past Expires from store', async () => {
    const { getSetCookie } = await import('../src/client');
    const prevCookie = JSON.stringify({
      'better-auth.session_token': { value: 'abc123', expires: null },
    });
    const pastDate = new Date(Date.now() - 1000).toUTCString();
    const header = `better-auth.session_token=; Expires=${pastDate}`;
    const result = JSON.parse(getSetCookie(header, prevCookie));
    expect(result['better-auth.session_token']).toBeUndefined();
  });

  it('should correctly parse multiple Set-Cookie headers with Expires commas', async () => {
    const header =
      'better-auth.session_token=abc; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/, better-auth.session_data=xyz; Expires=Thu, 22 Oct 2015 07:28:00 GMT; Path=/';
    const map = (await import('../src/client')).parseSetCookieHeader(header);
    expect(map.get('better-auth.session_token')?.value).toBe('abc');
    expect(map.get('better-auth.session_data')?.value).toBe('xyz');
  });

  it('should skip cookies with empty names', async () => {
    const { parseSetCookieHeader, getSetCookie } =
      await import('../src/client');

    const malformedHeader = '; abc.state=xyz; Path=/';
    const parsed = parseSetCookieHeader(malformedHeader);
    expect(parsed.has('')).toBe(false);

    const header2 = '=empty-value; Path=/, valid-cookie=value; Path=/';
    const parsed2 = parseSetCookieHeader(header2);
    expect(parsed2.has('')).toBe(false);
    expect(parsed2.get('valid-cookie')?.value).toBe('value');

    const prevCookie = JSON.stringify({
      'abc.session_token': {
        value: 'valid-token',
        expires: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      },
    });
    const result = getSetCookie(malformedHeader, prevCookie);
    const resultParsed = JSON.parse(result);
    expect(resultParsed['abc.session_token']).toBeDefined();
    expect(resultParsed['abc.session_token'].value).toBe('valid-token');
  });

  it('should not trigger infinite refetch with non-better-auth cookies', async () => {
    const { hasBetterAuthCookies } = await import('../src/client');

    expect(
      hasBetterAuthCookies(
        'better-auth.session_token=abc; Path=/',
        'better-auth'
      )
    ).toBe(true);
    expect(
      hasBetterAuthCookies(
        'better-auth.session_data=xyz; Path=/',
        'better-auth'
      )
    ).toBe(true);
    expect(
      hasBetterAuthCookies(
        '__Secure-better-auth.session_token=abc; Path=/',
        'better-auth'
      )
    ).toBe(true);
    expect(
      hasBetterAuthCookies(
        '__Secure-better-auth.session_data=xyz; Path=/',
        'better-auth'
      )
    ).toBe(true);
    expect(
      hasBetterAuthCookies(
        '__cf_bm=abc123; Path=/; HttpOnly; Secure',
        'better-auth'
      )
    ).toBe(false);
    expect(
      hasBetterAuthCookies(
        '__cf_bm=abc123; Path=/; HttpOnly; Secure, better-auth.session_token=xyz; Path=/',
        'better-auth'
      )
    ).toBe(true);
    expect(
      hasBetterAuthCookies('my-app.session_token=abc; Path=/', 'my-app')
    ).toBe(true);
    expect(
      hasBetterAuthCookies('my-app.session_token=abc; Path=/', 'better-auth')
    ).toBe(false);
    expect(
      hasBetterAuthCookies('my-app.session_data=abc; Path=/', 'my-app')
    ).toBe(true);
    expect(hasBetterAuthCookies('session_token=abc; Path=/', '')).toBe(true);
    expect(
      hasBetterAuthCookies('my_custom_session_token=abc; Path=/', '')
    ).toBe(true);
    expect(hasBetterAuthCookies('my_custom_session_data=xyz; Path=/', '')).toBe(
      true
    );
    expect(
      hasBetterAuthCookies(
        '__cf_bm=abc123; Path=/, _ga=GA1.2.123456789.1234567890; Path=/',
        'better-auth'
      )
    ).toBe(false);
    expect(
      hasBetterAuthCookies(
        'better-auth.other_cookie=abc; Path=/',
        'better-auth'
      )
    ).toBe(true);
    expect(
      hasBetterAuthCookies('better-auth-passkey=xyz; Path=/', 'better-auth')
    ).toBe(true);
    expect(
      hasBetterAuthCookies(
        '__Secure-better-auth-passkey=xyz; Path=/',
        'better-auth'
      )
    ).toBe(true);
    expect(
      hasBetterAuthCookies(
        'better-auth-custom-challenge=xyz; Path=/',
        'better-auth'
      )
    ).toBe(true);
  });

  it('should preserve unchanged client store session properties on signout', async () => {
    const before = client.$store.atoms.session!.get();
    await client.signOut();
    const after = client.$store.atoms.session!.get();

    expect(after).toMatchObject({
      ...before,
      data: null,
      error: null,
      isPending: false,
    });
  });

  it('should modify rn-origin header if origin is not set', async () => {
    let originalOrigin = null;
    let origin = null;
    const storage = new Map<string, string>();
    const { client, testUser } = await getTestInstance(
      {
        hooks: {
          before: createAuthMiddleware(async (ctx) => {
            origin = ctx.request?.headers.get('origin');
          }),
        },
        plugins: [
          {
            id: 'test',
            async onRequest(request) {
              originalOrigin = request.headers.get('origin');
            },
          },
          reactNative(),
        ],
      },
      {
        clientOptions: {
          plugins: [
            reactNativeClient({
              scheme: 'better-auth',
              storage: {
                getItem: (key) => storage.get(key) || null,
                setItem: async (key, value) => storage.set(key, value),
              },
            }),
          ],
        },
      }
    );
    await client.signIn.email({
      email: testUser.email,
      password: testUser.password,
      callbackURL: 'http://localhost:3000/callback',
    });
    expect(origin).toBe('better-auth://');
    expect(originalOrigin).toBeNull();
  });

  describe('origin override regression', () => {
    it('should preserve the incoming request instance when headers are mutable', async () => {
      let originalRequest: Request | undefined;
      let currentRequest: Request | undefined;
      const storage = new Map<string, string>();
      const { client, testUser } = await getTestInstance(
        {
          hooks: {
            before: createAuthMiddleware(async (ctx) => {
              currentRequest = ctx.request;
            }),
          },
          plugins: [
            {
              id: 'test',
              async onRequest(request) {
                originalRequest = request;
              },
            },
            reactNative(),
          ],
        },
        {
          clientOptions: {
            plugins: [
              reactNativeClient({
                scheme: 'better-auth',
                storage: {
                  getItem: (key) => storage.get(key) || null,
                  setItem: async (key, value) => storage.set(key, value),
                },
              }),
            ],
          },
        }
      );
      await client.signIn.email({
        email: testUser.email,
        password: testUser.password,
        callbackURL: 'http://localhost:3000/callback',
      });
      expect(currentRequest).toBe(originalRequest);
    });

    it('should clone the request when origin header mutation fails', async () => {
      let origin = null;
      let originalRequest: Request | undefined;
      let currentRequest: Request | undefined;
      const storage = new Map<string, string>();
      const { client, testUser } = await getTestInstance(
        {
          hooks: {
            before: createAuthMiddleware(async (ctx) => {
              currentRequest = ctx.request;
              origin = ctx.request?.headers.get('origin');
            }),
          },
          plugins: [
            {
              id: 'test',
              async onRequest(request) {
                originalRequest = request;
                Object.defineProperty(request.headers, 'set', {
                  configurable: true,
                  value: () => {
                    throw new Error('immutable headers');
                  },
                });
              },
            },
            reactNative(),
          ],
        },
        {
          clientOptions: {
            plugins: [
              reactNativeClient({
                scheme: 'better-auth',
                storage: {
                  getItem: (key) => storage.get(key) || null,
                  setItem: async (key, value) => storage.set(key, value),
                },
              }),
            ],
          },
        }
      );
      await client.signIn.email({
        email: testUser.email,
        password: testUser.password,
        callbackURL: 'http://localhost:3000/callback',
      });
      expect(origin).toBe('better-auth://');
      expect(currentRequest).toBeDefined();
      expect(currentRequest).not.toBe(originalRequest);
    });
  });

  it('should not modify origin header if origin is set', async () => {
    const originalOrigin = 'test.com';
    let origin = null;
    const { client, testUser } = await getTestInstance({
      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          origin = ctx.request?.headers.get('origin');
        }),
      },
      plugins: [reactNative()],
    });
    await client.signIn.email(
      {
        email: testUser.email,
        password: testUser.password,
        callbackURL: 'http://localhost:3000/callback',
      },
      {
        headers: {
          origin: originalOrigin,
        },
      }
    );
    expect(origin).toBe(originalOrigin);
  });

  it('should not modify origin header if disableOriginOverride is set', async () => {
    let origin = null;
    const storage = new Map<string, string>();
    const { client, testUser } = await getTestInstance(
      {
        hooks: {
          before: createAuthMiddleware(async (ctx) => {
            origin = ctx.request?.headers.get('origin');
          }),
        },
        plugins: [reactNative({ disableOriginOverride: true })],
      },
      {
        clientOptions: {
          plugins: [
            reactNativeClient({
              scheme: 'better-auth',
              storage: {
                getItem: (key) => storage.get(key) || null,
                setItem: async (key, value) => storage.set(key, value),
              },
            }),
          ],
        },
      }
    );
    await client.signIn.email({
      email: testUser.email,
      password: testUser.password,
      callbackURL: 'http://localhost:3000/callback',
    });
    expect(origin).toBeNull();
  });
});
