"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { addJobFromUrl, addSource, changeStatus, login } from "@/app/actions";

export function SubmitButton({
  children,
  pending: pendingLabel,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  pending?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-stone-900 text-white hover:bg-stone-700",
    secondary: "border border-stone-300 bg-white text-stone-800 hover:border-stone-500",
    ghost: "text-stone-500 hover:text-stone-900",
  };
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {pending ? (pendingLabel ?? "…") : children}
    </button>
  );
}

/** A <select> that submits its form on change, for one-click status moves. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  return <select ref={ref} {...props} onChange={() => ref.current?.form?.requestSubmit()} />;
}

/**
 * Interessant / Ikke aktuell on an inbox card. The card is hidden the moment
 * you click, instead of waiting for the server round trip and re-render.
 */
export function CardActions({ jobId }: { jobId: string }) {
  const hideCard = (e: React.FormEvent<HTMLFormElement>) => {
    const card = e.currentTarget.closest("li");
    if (card) card.hidden = true;
  };
  return (
    <div className="flex gap-1.5">
      <form action={changeStatus} onSubmit={hideCard}>
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="status" value="INTERESSANT" />
        <SubmitButton>Interessant</SubmitButton>
      </form>
      <form action={changeStatus} onSubmit={hideCard}>
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="status" value="IKKE_AKTUELL" />
        <SubmitButton variant="secondary">Ikke aktuell</SubmitButton>
      </form>
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [error, action] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="neste" value={next ?? "/"} />
      <input
        type="password"
        name="password"
        autoFocus
        required
        placeholder="Passord"
        className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <SubmitButton pending="Logger inn…" className="w-full">
        Logg inn
      </SubmitButton>
    </form>
  );
}

export function AddUrlForm() {
  const [error, action] = useActionState(addJobFromUrl, null);
  return (
    <form action={action} className="flex w-full flex-col gap-1 sm:w-auto">
      <div className="flex gap-2">
        <input
          name="url"
          type="url"
          required
          placeholder="Lim inn lenke til en annonse…"
          className="w-full min-w-0 rounded-md border border-stone-300 px-3 py-1.5 text-sm sm:w-80"
        />
        <SubmitButton pending="Henter…">Legg til</SubmitButton>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}

export function AddSourceForm() {
  const [error, action] = useActionState(addSource, null);
  return (
    <form action={action} className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-[1fr_14rem_auto]">
      <input
        name="value"
        required
        placeholder="Lim inn en karriereside / søke-URL, eller skriv søkeord (blir finn + NAV)"
        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm"
      />
      <input
        name="extra"
        placeholder="Valgfritt: lenke-regex / finn-lokasjon"
        title="Karriereside: regex som annonselenkene matcher. Søkeord: finn-lokasjonskode (1.20001.20061 = Oslo)."
        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm"
      />
      <SubmitButton pending="Sjekker…">Legg til kilde</SubmitButton>
      <p className="text-xs text-stone-500 sm:col-span-3">
        Gjenkjenner finn.no, arbeidsplassen.nav.no, Teamtailor, Webcruiter og Phenom (BCG o.l.) automatisk. Andre sider leses som
        karriereside via annonsenes JSON-LD, eller med Claude.
      </p>
      {error && <p className="text-sm text-rose-600 sm:col-span-3">{error}</p>}
    </form>
  );
}
