import Anthropic from "@anthropic-ai/sdk";
import type { Category, EmailClass, JobStatus, JobType } from "@prisma/client";

export const FAST_MODEL = "claude-haiku-4-5-20251001";
export const SMART_MODEL = "claude-sonnet-5";

let client: Anthropic | null | undefined;

/** null when no key is configured, so every AI step can degrade instead of failing the whole run. */
function getClient(): Anthropic | null {
  if (client === undefined) {
    client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  }
  return client;
}

async function callTool<T>(opts: {
  model: string;
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
}): Promise<T | null> {
  const ai = getClient();
  if (!ai) return null;
  const res = await ai.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    tools: [opts.tool],
    tool_choice: { type: "tool", name: opts.tool.name },
    messages: [{ role: "user", content: opts.user }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  return block ? (block.input as T) : null;
}

export const CATEGORIES: Category[] = [
  "VC",
  "PE",
  "MA",
  "INVESTERINGSSELSKAP",
  "IB_ER",
  "FORVALTNING",
  "EIENDOM",
  "CORP_FIN",
  "CONTROLLER",
  "ANNET",
];
export const JOB_TYPES: JobType[] = ["DELTID_STUDENT", "INTERNSHIP", "GRADUATE", "FAST", "ANNET"];

export interface ScoreInput {
  id: string;
  title: string;
  company: string;
  city?: string | null;
  employmentType?: string | null;
  description: string;
}

export interface Score {
  id: string;
  score: number;
  category: Category;
  jobType: JobType;
  reason: string;
  deadline?: string;
}

const SCORE_TOOL: Anthropic.Tool = {
  name: "rate_jobs",
  description: "Record a relevance rating for every job in the list.",
  input_schema: {
    type: "object",
    properties: {
      ratings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            score: { type: "integer", minimum: 0, maximum: 100 },
            category: { type: "string", enum: CATEGORIES },
            jobType: { type: "string", enum: JOB_TYPES },
            reason: { type: "string", description: "Én kort setning på norsk: hvorfor den passer eller ikke." },
            deadline: {
              type: "string",
              description: "Søknadsfrist som YYYY-MM-DD hvis den står i teksten, ellers utelat.",
            },
          },
          required: ["id", "score", "category", "jobType", "reason"],
        },
      },
    },
    required: ["ratings"],
  },
};

export async function scoreJobs(jobs: ScoreInput[], criteria: string): Promise<Score[] | null> {
  if (jobs.length === 0) return [];
  const list = jobs
    .map(
      (j) =>
        `### id: ${j.id}\n${j.title} — ${j.company}${j.city ? ` (${j.city})` : ""}${
          j.employmentType ? ` [${j.employmentType}]` : ""
        }\n${j.description.slice(0, 1800)}`,
    )
    .join("\n\n");
  const out = await callTool<{ ratings: Score[] }>({
    model: FAST_MODEL,
    system: `Du vurderer stillingsannonser for én bestemt jobbsøker. Jobbsøkerens kriterier:\n\n${criteria}\n\nVær streng: bare stillinger jobbsøkeren realistisk kan søke og faktisk vil ha skal over 60.`,
    user: `Vurder alle ${jobs.length} annonsene:\n\n${list}`,
    tool: SCORE_TOOL,
    maxTokens: 300 * jobs.length + 500,
  });
  return out?.ratings ?? null;
}

export interface ExtractedJob {
  title: string;
  company: string;
  description: string;
  streetAddress?: string;
  city?: string;
  country?: string;
  employmentType?: string;
  deadline?: string;
  deadlineText?: string;
  contactName?: string;
  contactTitle?: string;
  contactPhone?: string;
  contactEmail?: string;
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "save_job",
  description: "Save the job ad found on the page.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "false if the page is not a single job ad" },
      title: { type: "string" },
      company: { type: "string" },
      description: {
        type: "string",
        description: "The full ad text exactly as written (not a summary), with line breaks and • bullets.",
      },
      streetAddress: { type: "string" },
      city: { type: "string" },
      country: { type: "string" },
      employmentType: { type: "string" },
      deadline: { type: "string", description: "YYYY-MM-DD" },
      deadlineText: { type: "string", description: "e.g. 'Snarest' when there is no date" },
      contactName: { type: "string" },
      contactTitle: { type: "string" },
      contactPhone: { type: "string" },
      contactEmail: { type: "string" },
    },
    required: ["found"],
  },
};

/** Fallback for pages without JSON-LD: let the model lift the ad out of the page text. */
export async function extractJob(pageText: string, url: string): Promise<ExtractedJob | null> {
  const out = await callTool<ExtractedJob & { found: boolean }>({
    model: FAST_MODEL,
    system: "Du henter ut stillingsannonser fra nettsider. Kopier annonseteksten ordrett; ikke finn på noe.",
    user: `URL: ${url}\n\n${pageText.slice(0, 30000)}`,
    tool: EXTRACT_TOOL,
    maxTokens: 8000,
  });
  if (!out?.found || !out.title) return null;
  return out;
}

export interface EmailInput {
  key: string;
  from: string;
  subject: string;
  snippet: string;
}

export interface EmailVerdict {
  key: string;
  relevant: boolean;
  classification: EmailClass;
  jobId?: string;
  confidence: number;
  suggestedStatus?: JobStatus;
}

const EMAIL_TOOL: Anthropic.Tool = {
  name: "classify_emails",
  description: "Classify each e-mail and link it to an application when possible.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            relevant: { type: "boolean", description: "true only if the e-mail is about a job application or a recruitment process" },
            classification: {
              type: "string",
              enum: ["BEKREFTELSE", "INTERVJU", "AVSLAG", "TILBUD", "FORESPORSEL", "ANNET"],
            },
            jobId: { type: "string", description: "id of the matching application, if any" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            suggestedStatus: {
              type: "string",
              enum: ["SENDT", "INTERVJU", "TILBUD", "AVSLAG"],
              description: "the status the application should move to, if the e-mail implies a change",
            },
          },
          required: ["key", "relevant", "classification", "confidence"],
        },
      },
    },
    required: ["verdicts"],
  },
};

export async function classifyEmails(
  emails: EmailInput[],
  applications: { id: string; company: string; title: string; contactEmail?: string | null }[],
): Promise<EmailVerdict[] | null> {
  if (emails.length === 0) return [];
  const apps = applications
    .map((a) => `- ${a.id}: ${a.title} hos ${a.company}${a.contactEmail ? ` (${a.contactEmail})` : ""}`)
    .join("\n");
  const mails = emails
    .map((e) => `### key: ${e.key}\nFra: ${e.from}\nEmne: ${e.subject}\n${e.snippet}`)
    .join("\n\n");
  const out = await callTool<{ verdicts: EmailVerdict[] }>({
    model: FAST_MODEL,
    system:
      "Du går gjennom innboksen til en jobbsøker og finner svar på søknadene. BEKREFTELSE = mottatt søknad, INTERVJU = invitasjon til samtale/case/test, AVSLAG = nei, TILBUD = jobbtilbud, FORESPORSEL = rekrutterer tar kontakt om noe annet.",
    user: `Aktive søknader:\n${apps || "(ingen)"}\n\nE-poster:\n\n${mails}`,
    tool: EMAIL_TOOL,
    maxTokens: 200 * emails.length + 500,
  });
  return out?.verdicts ?? null;
}

export async function matchAnalysis(
  job: { title: string; company: string; description: string },
  criteria: string,
): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;
  const res = await ai.messages.create({
    model: SMART_MODEL,
    max_tokens: 2000,
    system: `Du er en ærlig karriererådgiver for denne kandidaten:\n\n${criteria}\n\nSvar på norsk, kort og konkret. Ikke finn på erfaring kandidaten ikke har.`,
    messages: [
      {
        role: "user",
        content: `Stilling: ${job.title} hos ${job.company}\n\n${job.description.slice(0, 12000)}\n\nGi meg:\n1. Passer den? (en setning + score 0–100)\n2. De 3 sterkeste koblingene til min bakgrunn\n3. Hull eller risiko jeg bør adressere\n4. To spørsmål å stille hvis jeg ringer kontaktpersonen`,
      },
    ],
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
