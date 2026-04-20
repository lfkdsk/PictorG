import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'gh_oauth_state';
const RETURN_TO_COOKIE = 'gh_oauth_return_to';
const HANDOFF_COOKIE = 'gh_oauth_handoff';

function resolveRedirectUri(req: NextRequest): string {
  const configured = process.env.GITHUB_OAUTH_REDIRECT_URI;
  if (configured) return configured;
  const origin = req.nextUrl.origin;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${origin}${basePath}/api/auth/github/callback`;
}

function errorRedirect(req: NextRequest, message: string): NextResponse {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const url = new URL(`${basePath}/login`, req.nextUrl.origin);
  url.searchParams.set('oauth_error', message);
  return NextResponse.redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorRedirect(req, 'GitHub OAuth 未配置');
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const ghError = req.nextUrl.searchParams.get('error');
  if (ghError) {
    return errorRedirect(req, req.nextUrl.searchParams.get('error_description') || ghError);
  }
  if (!code || !state) {
    return errorRedirect(req, '缺少 code 或 state 参数');
  }

  const storedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!storedState || storedState !== state) {
    return errorRedirect(req, 'state 校验失败，请重试登录');
  }

  let accessToken: string;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: resolveRedirectUri(req),
        state
      })
    });

    if (!tokenRes.ok) {
      return errorRedirect(req, `GitHub 令牌请求失败：${tokenRes.status}`);
    }

    const payload = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!payload.access_token) {
      return errorRedirect(req, payload.error_description || payload.error || '未能获取到 access_token');
    }
    accessToken = payload.access_token;
  } catch (e) {
    return errorRedirect(req, '交换令牌时发生网络错误');
  }

  const returnTo = req.cookies.get(RETURN_TO_COOKIE)?.value;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const callbackUrl = new URL(`${basePath}/login/callback`, req.nextUrl.origin);
  if (returnTo && returnTo.startsWith('/')) {
    callbackUrl.searchParams.set('return_to', returnTo);
  }

  const response = NextResponse.redirect(callbackUrl.toString());
  const isSecure = req.nextUrl.protocol === 'https:';

  // 短期 handoff cookie：客户端会读取并迁移到 localStorage 后立即清除。
  response.cookies.set(HANDOFF_COOKIE, accessToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 60 * 2
  });

  response.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 });
  response.cookies.set(RETURN_TO_COOKIE, '', { path: '/', maxAge: 0 });

  return response;
}
