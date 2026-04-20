import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'gh_oauth_state';
const RETURN_TO_COOKIE = 'gh_oauth_return_to';

function randomState(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function resolveRedirectUri(req: NextRequest): string {
  const configured = process.env.GITHUB_OAUTH_REDIRECT_URI;
  if (configured) return configured;
  const origin = req.nextUrl.origin;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${origin}${basePath}/api/auth/github/callback`;
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'GitHub OAuth 未配置：请在环境变量中设置 GITHUB_CLIENT_ID 与 GITHUB_CLIENT_SECRET。' },
      { status: 500 }
    );
  }

  const state = randomState();
  const redirectUri = resolveRedirectUri(req);
  const scope = process.env.GITHUB_OAUTH_SCOPE || 'repo workflow read:user user:email';

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('allow_signup', 'true');

  const response = NextResponse.redirect(authorizeUrl.toString());
  const isSecure = req.nextUrl.protocol === 'https:';

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 60 * 10
  });

  const returnTo = req.nextUrl.searchParams.get('return_to');
  if (returnTo && returnTo.startsWith('/')) {
    response.cookies.set(RETURN_TO_COOKIE, returnTo, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
      maxAge: 60 * 10
    });
  }

  return response;
}
