"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("Checking...");
  const BACKEND_API = process.env.NEXT_PUBLIC_BACKEND_URL;

  useEffect(() => {
    fetch(`${BACKEND_API}/`)
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus("Backend unavailable"));
  }, [BACKEND_API]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white">
          URL Shortener
        </h1>

        <p className="mt-2 text-slate-400">
          Simple. Fast. Short.
        </p>

        <p className="mt-6 text-sm text-slate-500">
          Backend:{" "}
          <span
            className={
              status === "ok"
                ? "text-green-400"
                : "text-red-400"
            }
          >
            {status}
          </span>
        </p>
      </div>
    </main>
  );
}
