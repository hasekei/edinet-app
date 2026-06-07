import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { code, codeVerifier, redirectUri } = await req.json();

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "サーバー設定エラー: 環境変数が未設定です" }, { status: 500 });
  }
  if (!code || !codeVerifier || !redirectUri) {
    return NextResponse.json({ error: "必須パラメータが不足しています" }, { status: 400 });
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    return NextResponse.json({ error: `Googleトークン取得失敗: ${msg}` }, { status: 400 });
  }

  return NextResponse.json({ access_token: data.access_token });
}
