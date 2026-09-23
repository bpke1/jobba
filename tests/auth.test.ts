import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { looksRelevant } from "@/lib/mail";
import { verifyPassword } from "@/lib/password";

const salt = randomBytes(16);
const stored = `scrypt:${salt.toString("hex")}:${scryptSync("riktig", salt, 32).toString("hex")}`;

describe("verifyPassword", () => {
  it("accepts the right password and rejects others", () => {
    expect(verifyPassword("riktig", stored)).toBe(true);
    expect(verifyPassword("feil", stored)).toBe(false);
  });

  it("rejects everything when the stored hash is missing or malformed", () => {
    expect(verifyPassword("", undefined)).toBe(false);
    expect(verifyPassword("x", "scrypt:abcd:zz")).toBe(false);
    expect(verifyPassword("x", `scrypt$${salt.toString("hex")}$abc`)).toBe(false);
  });
});

describe("looksRelevant (mail pre-filter)", () => {
  it("keeps ATS senders, application subjects and active-application domains", () => {
    expect(looksRelevant("ABG <no-reply@teamtailor.com>", "Thanks", [])).toBe(true);
    expect(looksRelevant("hr@x.no", "Takk for din søknad", [])).toBe(true);
    expect(looksRelevant("Kari <kari@examplecapital.no>", "Hei", ["examplecapital"])).toBe(true);
  });

  it("drops newsletters and marketing", () => {
    expect(looksRelevant("news@elkjop.no", "Tilbud: 30% på alt", ["examplecapital"])).toBe(false);
  });
});
