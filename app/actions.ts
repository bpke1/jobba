"use server";

import type { JobStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { matchAnalysis } from "@/lib/ai";
import { db } from "@/lib/db";
import { setStatus } from "@/lib/jobs";
import { checkMail } from "@/lib/mail";
import { verifyPassword } from "@/lib/password";
import { getCriteria } from "@/lib/profile";
import { addFromUrl, runScrape, scorePending } from "@/lib/scrape";
import { fetchAnyAd } from "@/lib/sources/career-page";
import { detectSources } from "@/lib/sources/detect";
import { createSessionToken, isValidSession, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

// Proxy already guards every page, but server actions are plain POST endpoints,
// so each one checks the session again rather than trusting the route.
async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(token))) redirect("/login");
}

export async function login(_: string | null, form: FormData): Promise<string | null> {
  if (!verifyPassword(String(form.get("password") ?? ""))) return "Feil passord.";
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 86400,
    path: "/",
  });
  const next = String(form.get("neste") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

function refresh(jobId?: string) {
  revalidatePath("/", "layout");
  if (jobId) revalidatePath(`/jobb/${jobId}`);
}

export async function changeStatus(form: FormData) {
  await requireSession();
  const jobId = String(form.get("jobId"));
  await setStatus(jobId, String(form.get("status")) as JobStatus);
  refresh(jobId);
}

const dateOrNull = (v: FormDataEntryValue | null) => (v ? new Date(String(v)) : null);
const textOrNull = (v: FormDataEntryValue | null) => (v && String(v).trim() ? String(v).trim() : null);

export async function saveJobDetails(form: FormData) {
  await requireSession();
  const jobId = String(form.get("jobId"));
  await db.job.update({
    where: { id: jobId },
    data: {
      nextStep: textOrNull(form.get("nextStep")),
      nextStepDate: dateOrNull(form.get("nextStepDate")),
      appliedAt: dateOrNull(form.get("appliedAt")),
      channel: textOrNull(form.get("channel")),
      deadline: dateOrNull(form.get("deadline")),
      contactName: textOrNull(form.get("contactName")),
      contactPhone: textOrNull(form.get("contactPhone")),
      contactEmail: textOrNull(form.get("contactEmail")),
      notes: textOrNull(form.get("notes")),
    },
  });
  refresh(jobId);
}

export async function addEvent(form: FormData) {
  await requireSession();
  const jobId = String(form.get("jobId"));
  const text = textOrNull(form.get("text"));
  if (!text) return;
  await db.event.create({ data: { jobId, type: form.get("type") === "CALL" ? "CALL" : "NOTE", text } });
  refresh(jobId);
}

export async function runMatchAnalysis(form: FormData) {
  await requireSession();
  const jobId = String(form.get("jobId"));
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const text = await matchAnalysis(job, await getCriteria());
  await db.event.create({
    data: { jobId, type: "NOTE", text: `Match-analyse:\n\n${text ?? "(ANTHROPIC_API_KEY mangler)"}` },
  });
  refresh(jobId);
}

export async function addJobFromUrl(_: string | null, form: FormData): Promise<string | null> {
  await requireSession();
  const url = String(form.get("url") ?? "").trim();
  if (!/^https?:\/\//.test(url)) return "Lim inn en full lenke (https://…).";
  let id: string;
  try {
    id = await addFromUrl(url);
  } catch (e) {
    return e instanceof Error ? e.message : "Noe gikk galt.";
  }
  refresh();
  redirect(`/jobb/${id}`);
}

/** For jobs stored without text (LinkedIn alerts): fetch the ad page once, on request. */
export async function refetchDescription(form: FormData) {
  await requireSession();
  const jobId = String(form.get("jobId"));
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const listing = await fetchAnyAd(job.url).catch(() => null);
  if (listing?.description) {
    await db.job.update({
      where: { id: jobId },
      data: {
        description: listing.description,
        streetAddress: job.streetAddress ?? listing.streetAddress,
        city: job.city ?? listing.city,
        deadline: job.deadline ?? listing.deadline,
        contactName: job.contactName ?? listing.contactName,
        contactEmail: job.contactEmail ?? listing.contactEmail,
        scoredAt: null, // re-score now that there is a real description
      },
    });
    await scorePending(Date.now() + 40_000);
  } else {
    await db.event.create({ data: { jobId, type: "NOTE", text: "Fant ikke annonseteksten automatisk. Åpne annonsen og lim inn teksten i notater." } });
  }
  refresh(jobId);
}

export async function runSourceNow(form: FormData) {
  await requireSession();
  await runScrape({ sourceId: String(form.get("sourceId")), deadlineMs: 50_000 });
  refresh();
}

export async function toggleSource(form: FormData) {
  await requireSession();
  const id = String(form.get("sourceId"));
  const src = await db.source.findUniqueOrThrow({ where: { id } });
  await db.source.update({ where: { id }, data: { enabled: !src.enabled } });
  refresh();
}

export async function deleteSource(form: FormData) {
  await requireSession();
  await db.source.delete({ where: { id: String(form.get("sourceId")) } });
  refresh();
}

export async function addSource(_: string | null, form: FormData): Promise<string | null> {
  await requireSession();
  const value = String(form.get("value") ?? "").trim();
  if (!value) return "Lim inn en URL eller skriv søkeord.";
  const detected = await detectSources(value, String(form.get("extra") ?? ""));
  if (typeof detected === "string") return detected;
  const name = String(form.get("name") ?? "").trim();
  for (const d of detected) {
    await db.source.create({ data: { type: d.type, config: d.config, name: detected.length === 1 && name ? name : d.name } });
  }
  refresh();
  return null;
}

export async function saveCriteria(form: FormData) {
  await requireSession();
  const value = String(form.get("criteria") ?? "");
  await db.setting.upsert({ where: { key: "profileCriteria" }, create: { key: "profileCriteria", value }, update: { value } });
  if (form.get("rescore") === "on") {
    // Re-rate only what's still in the inbox; pipeline jobs keep their history.
    await db.job.updateMany({ where: { status: { in: ["NY", "FILTRERT"] } }, data: { scoredAt: null, status: "NY" } });
  }
  refresh();
}

export async function checkMailNow() {
  await requireSession();
  await checkMail();
  refresh();
}

export async function acceptEmailSuggestion(form: FormData) {
  await requireSession();
  const email = await db.email.findUniqueOrThrow({ where: { id: String(form.get("emailId")) } });
  if (email.jobId && email.suggestedStatus) {
    await setStatus(email.jobId, email.suggestedStatus, `fra e-post: ${email.subject}`);
  }
  await db.email.update({ where: { id: email.id }, data: { handled: true } });
  refresh(email.jobId ?? undefined);
}

export async function dismissEmail(form: FormData) {
  await requireSession();
  await db.email.update({ where: { id: String(form.get("emailId")) }, data: { handled: true } });
  refresh();
}

export async function linkEmail(form: FormData) {
  await requireSession();
  const emailId = String(form.get("emailId"));
  const jobId = String(form.get("jobId"));
  if (!jobId) return;
  const email = await db.email.update({ where: { id: emailId }, data: { jobId } });
  await db.event.create({
    data: { jobId, type: "EMAIL", text: `${email.classification}: ${email.subject} (fra ${email.from})`, at: email.receivedAt },
  });
  refresh(jobId);
}
