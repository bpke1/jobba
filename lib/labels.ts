import type { Category, JobStatus, JobType } from "@prisma/client";

export const STATUS_LABEL: Record<JobStatus, string> = {
  NY: "Ny",
  FILTRERT: "Filtrert bort",
  INTERESSANT: "Interessant",
  UNDER_ARBEID: "Under arbeid",
  SENDT: "Sendt",
  INTERVJU: "Intervju",
  TILBUD: "Tilbud",
  AVSLAG: "Avslag",
  IKKE_AKTUELL: "Ikke aktuell",
};

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  DELTID_STUDENT: "Deltid/student",
  INTERNSHIP: "Internship",
  GRADUATE: "Graduate",
  FAST: "Fulltid",
  ANNET: "Annet",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  VC: "Venture",
  PE: "Private equity",
  MA: "M&A",
  INVESTERINGSSELSKAP: "Investeringsselskap",
  IB_ER: "IB / research",
  FORVALTNING: "Forvaltning",
  EIENDOM: "Eiendom",
  CORP_FIN: "Corp. finance",
  CONTROLLER: "Controller",
  LEDER: "Toppleder (stretch)",
  ANNET: "Annet",
};
