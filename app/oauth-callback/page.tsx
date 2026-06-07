"use client";
import { useEffect, useState } from "react";

export default function OAuthCallbackPage() {
  const [status, setStatus] = useState("認証処理中...");

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const search = window.location.search.slice(1);
    const params = new URLSearchParams(hash || search);

    const accessToken = params.get("access_token");
    const error = params.get("error");
    const state = params.get("state");

    if (state) {
      const key = `google-oauth-${state}`;
      if (accessToken) {
        localStorage.setItem(key, JSON.stringify({ token: accessToken, timestamp: Date.now() }));
        setStatus("認証成功。このタブは自動的に閉じます...");
      } else {
        localStorage.setItem(key, JSON.stringify({ error: error ?? "unknown", timestamp: Date.now() }));
        setStatus(`認証エラー: ${error ?? "不明"}`);
      }
    }

    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: "GOOGLE_TOKEN", accessToken, error, state },
          window.location.origin
        );
      }
    } catch {
      // opener への postMessage が失敗しても localStorage 経由で動作する
    }

    setTimeout(() => window.close(), 500);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen text-sm text-muted-foreground">
      <p>{status}</p>
    </div>
  );
}
