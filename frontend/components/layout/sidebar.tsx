import Link from "next/link";

export function Sidebar() {
  return (
    <aside className="w-64 min-h-screen border-r p-4">
      <nav className="flex flex-col gap-4">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/links">Links</Link>
        <Link href="/analytics">Analytics</Link>
        <Link href="/security">Security</Link>
      </nav>
    </aside>
  );
}