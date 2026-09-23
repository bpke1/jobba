import { LoginForm } from "@/components/client";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { neste } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-xs space-y-4">
        <h1 className="text-center text-xl font-semibold">Jobba</h1>
        <LoginForm next={typeof neste === "string" ? neste : undefined} />
      </div>
    </main>
  );
}
