import { connection } from "next/server";
import { saveCriteria } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { PageTitle } from "@/components/ui";
import { getCriteria } from "@/lib/profile";

export default async function ProfilePage() {
  await connection();
  const criteria = await getCriteria();
  return (
    <>
      <PageTitle
        title="Profil og kriterier"
        sub="Claude bruker denne teksten til å score hver ny annonse (0–100). Juster den når du vet mer om hva du vil ha."
      />
      <form action={saveCriteria} className="space-y-3">
        <textarea
          name="criteria"
          defaultValue={criteria}
          rows={30}
          className="w-full rounded-lg border border-stone-300 bg-white p-4 font-mono text-[13px] leading-relaxed"
        />
        <div className="flex items-center gap-4">
          <SubmitButton pending="Lagrer…">Lagre</SubmitButton>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" name="rescore" /> Score nye og filtrerte annonser på nytt ved neste kjøring
          </label>
        </div>
      </form>
    </>
  );
}
