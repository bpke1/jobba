import type { Category, JobType } from "@prisma/client";
import { CATEGORY_LABEL } from "./labels";

/**
 * Keyword rules that give every ad a job type, sector and rough score the
 * moment it's stored, so filters and sorting work without an API key. When
 * Claude scores the ad later its verdict replaces these values.
 */

export interface Classification {
  jobType: JobType;
  category: Category;
  score: number;
  reason: string;
}

interface Input {
  title: string;
  company: string;
  description?: string | null;
  employmentType?: string | null;
  city?: string | null;
  country?: string | null;
  remote?: string | null;
}

const INVESTMENT_COMPANIES =
  /\b(ferd|kistefos|canica|aker asa|aker capital|mustad|sundt|reitan|stein erik hagen|nysnø|investinor|norfund|folketrygdfondet|nbim|norges bank investment|summa equity|fsn capital|herkules|verdane|altor|hitecvision|norselab|alliance venture|northzone|viking venture|viking growth|katapult|skagerak capital|credo partners|njord|pitch40|arkwright|oslo pensjonsforsikring)\b/i;

// First match wins, so the most specific / most wanted sectors come first.
const CATEGORY_RULES: [Category, RegExp][] = [
  [
    "LEDER",
    /\b(ceo|cfo|coo|cio|daglig leder|administrerende direktør|adm\.? ?dir\w*|finansdirektør|økonomidirektør|investeringsdirektør|investment director|chief \w+ officer|managing director|country manager|konsernsjef)\b/i,
  ],
  // \b keeps "Adventure" out; the lookbehind keeps "joint venture" out
  ["VC", /(?<!joint[- ])\bventure|såkorn|seed-?fond|vc-fond|early[- ]stage invest/i],
  ["PE", /private equity|oppkjøpsfond|buyout|porteføljeselskap|portfolio compan/i],
  ["MA", /\bm&a\b|mergers|transaksjonsrådgiv|transaction services|deal advisory|due diligence|fusjon(er)? og oppkjøp/i],
  ["INVESTERINGSSELSKAP", /investeringsselskap|family office|investment company|investeringsteam|holdingselskap/i],
  [
    "IB_ER",
    /investment bank|investeringsbank|equity research|aksjeanaly|\becm\b|\bdcm\b|corporate finance|meglerhus|fondsmegl|securities|kapitalmarked|capital markets/i,
  ],
  [
    "FORVALTNING",
    /kapitalforvalt|asset management|portfolio manager|porteføljeforvalt|fondsforvalt|wealth management|formuesrådgiv|formuesforvalt|investment analyst|investeringsanalyti/i,
  ],
  ["EIENDOM", /eiendom|real estate|property|næringsbygg/i],
  ["CONTROLLER", /controller|økonomisjef|regnskapssjef|finance manager/i],
  [
    "CORP_FIN",
    /investor relations|strategi|strategy|forretningsutvikl|business development|fp&a|financial analyst|finansanalyti|analytiker|analyst|treasury|økonomi og finans|finance/i,
  ],
];

const TYPE_RULES: [JobType, RegExp][] = [
  ["INTERNSHIP", /intern(ship)?\b|sommerjobb|sommerintern|summer (analyst|associate|intern)|praktikant|sommervikar|off-cycle/i],
  ["GRADUATE", /graduate|trainee|nyutdannet|analyst program|analytikerprogram|junior (analyst|analytiker|associate)/i],
  ["DELTID_STUDENT", /student|deltid|part[- ]time|ved siden av studiene/i],
];

const BASE_SCORE: Record<Category, number> = {
  VC: 80,
  PE: 80,
  INVESTERINGSSELSKAP: 78,
  MA: 75,
  IB_ER: 70,
  FORVALTNING: 65,
  LEDER: 58,
  EIENDOM: 55,
  CORP_FIN: 55,
  CONTROLLER: 45,
  ANNET: 20,
};

// Roles where a sector found only in the ad text is believable ("analyst at a
// PE-owned company"); an engineer at a company "backed by private equity" is not.
const ANALYTICAL_TITLE =
  /analy|financ|finans|økonomi|invest|intern|trainee|graduate|controller|associate|strategi|strategy|m&a|corporate|kapital|capital|portef|portfolio|treasury|forretning|student|sommer/i;

const TECH_TITLE = /engineer|ingeniør|developer|utvikler|scientist|designer|arkitekt|architect|tekniker|technician/i;

const CONSULTING_FIRMS = /\b(boston consulting|bcg|mckinsey|bain|oliver wyman|roland berger|kearney)\b/i;

const OSLO_AREA = /oslo|bærum|lysaker|fornebu|skøyen|asker|lillestrøm|sandvika|stabekk/i;
const ABROAD_HUBS = /london|stockholm|københavn|copenhagen|new york|helsinki|zürich|zurich|frankfurt|luxembourg|singapore/i;
const SENIOR = /\bsenior\b|erfaren|head of|\bleder\b|manager|direktør|partner|principal|\bvp\b|vice president|sjef/i;

export function classify(job: Input): Classification {
  const head = `${job.title} ${job.company}`;
  const text = `${head} ${(job.description ?? "").slice(0, 1500)}`;

  // Sector: the title and company decide; the ad text only counts for analytical titles.
  const analytical = ANALYTICAL_TITLE.test(job.title) && !TECH_TITLE.test(job.title);
  const consulting = CONSULTING_FIRMS.test(job.company);
  let category: Category = INVESTMENT_COMPANIES.test(job.company) ? "INVESTERINGSSELSKAP" : "ANNET";
  const titleHit = CATEGORY_RULES.find(([, re]) => re.test(job.title));
  const companyHit = CATEGORY_RULES.find(([c, re]) => c !== "LEDER" && re.test(job.company));
  if (titleHit && (category === "ANNET" || titleHit[0] === "LEDER")) category = titleHit[0];
  // Known by the employer only (e.g. "… Securities"): a receptionist there is no finance job.
  const fromCompanyOnly = !titleHit && (category !== "ANNET" || !!companyHit);
  if (category === "ANNET" && companyHit) category = companyHit[0];
  let fromText = false;
  if (category === "ANNET" && analytical && !consulting) {
    const textHit = CATEGORY_RULES.find(([c, re]) => c !== "LEDER" && re.test(text))?.[0];
    if (textHit) {
      category = textHit;
      fromText = true;
    }
  }
  if (consulting && category === "ANNET" && analytical) category = "CORP_FIN";

  let jobType: JobType =
    TYPE_RULES.find(([, re]) => re.test(job.title))?.[0] ??
    (/internship/i.test(job.employmentType ?? "") ? "INTERNSHIP" : undefined) ??
    (/deltid/i.test(job.employmentType ?? "") && /student/i.test(text) ? "DELTID_STUDENT" : undefined) ??
    (/heltid|fast|full/i.test(job.employmentType ?? "") ? "FAST" : "ANNET");
  if (jobType === "ANNET" && /deltid/i.test(job.employmentType ?? "")) jobType = "DELTID_STUDENT";

  let score = BASE_SCORE[category];
  const notes: string[] = [];
  if (fromText) {
    score -= 15;
    notes.push("sektor fra annonseteksten");
  }
  if (consulting && analytical) {
    score += 15;
    notes.push("strategirådgivning");
  }
  if (fromCompanyOnly && !analytical && category !== "ANNET") {
    score -= 25;
    notes.push("ikke analytisk rolle");
  }
  if (jobType === "INTERNSHIP" || jobType === "DELTID_STUDENT") score += 8;
  if (jobType === "GRADUATE") score += 5;
  if (jobType !== "INTERNSHIP" && jobType !== "DELTID_STUDENT" && category !== "LEDER" && SENIOR.test(job.title)) {
    score -= 12;
    notes.push("senior");
  }

  const place = `${job.city ?? ""} ${job.country ?? ""}`;
  if (job.remote && /fjernarbeid|remote|fullt? hjemmekontor|helt hjemmekontor/i.test(job.remote)) {
    // fully remote is fine from anywhere; "delvis hjemmekontor" still means commuting
  } else if (!place.trim() || OSLO_AREA.test(place)) {
    // Oslo or unknown
  } else if (ABROAD_HUBS.test(place)) {
    score -= 5;
  } else if (!/norge|norway|^\s*no\s*$/i.test(place) || job.city) {
    score -= 20;
    notes.push(job.city ?? "utenfor Oslo");
  }

  score = Math.max(0, Math.min(100, score));
  const reason = `Regelbasert: ${category === "ANNET" ? "ingen målsektor funnet" : CATEGORY_LABEL[category]}${
    notes.length ? ` (${notes.join(", ")})` : ""
  }. Claude-score kommer når API-nøkkel er satt.`;
  return { jobType, category, score, reason };
}
