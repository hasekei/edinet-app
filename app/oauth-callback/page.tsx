"use client";
import { useEffect, useState } from "react";

export default function OAuthCallbackPage() {
  const [status, setStatus] = useState("認証処理中...");

  useEffect(() => {
    // 認可コードフローでは ?code=...&state=... がクエリパラメータで来る
    const params = new URLSearchParams(window.location.search.slice(1));
    const code = params.get("code");
    const error = params.get("error");
    const state = params.get("state");

    if (state) {
      const key = `google-oauth-${state}`;
      if (code) {
        localStorage.setItem(key, JSON.stringify({ code, timestamp: Date.now() }));
        setStatus("認証成功。このタブは自動的に閉じます...");
      } else {
        localStorage.setItem(key, JSON.stringify({ error: error ?? "unknown", timestamp: Date.now() }));
        setStatus(`認証エラー: ${error ?? "不明"}`);
      }
    }

    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: "GOOGLE_TOKEN", code, error, state },
          window.location.origin
        );
      }
    } catch {
      // window.opener が使えない場合は localStorage 経由で通信
    }

    setTimeout(() => window.close(), 500);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen text-sm text-muted-foreground">
      <p>{status}</p>
    </div>
  );
}
