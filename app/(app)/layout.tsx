import Link from "next/link";
import { connection } from "next/server";
import { logout } from "@/app/actions";
import { AddUrlForm } from "@/components/client";
import { db } from "@/lib/db";

// Nav badges only; if the DB is down the pages themselves will show the error,
// so the shell shouldn't take the whole site down with it.
async function counts() {
  try {
    const [fresh, inbox] = await Promise.all([
      db.job.count({ where: { status: "NY" } }),
      db.email.count({ where: { handled: false } }),
    ]);
    return { fresh, inbox };
  } catch {
    return { fresh: 0, inbox: 0 };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const { fresh, inbox } = await counts();
  const nav = [
    { href: "/", label: "Nye utlysninger", badge: fresh },
    { href: "/pipeline", label: "Pipeline" },
    { href: "/innboks", label: "Innboks", badge: inbox },
    { href: "/kilder", label: "Kilder" },
    { href: "/profil", label: "Profil" },
  ];

  return (
    <div className="px-4 sm:px-6">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-b border-stone-200 py-3">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <Link href="/" className="mr-3 font-semibold tracking-tight">
            Jobba
          </Link>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900">
              {n.label}
              {n.badge ? <span className="ml-1.5 rounded-full bg-stone-900 px-1.5 text-xs text-white">{n.badge}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <AddUrlForm />
          <form action={logout}>
            <button className="text-xs whitespace-nowrap text-stone-400 hover:text-stone-700">Logg ut</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl py-6">{children}</main>
    </div>
  );
}
