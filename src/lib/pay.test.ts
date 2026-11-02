import { describe, expect, it } from "vitest";
import { HOURS_PER_YEAR, parsePay } from "@/lib/pay";

const microsoft = [
  "Technical Program Management IC4 - The typical base pay range for this role across the U.S. is USD $119,800 - $234,700 per year.",
  "There is a different range applicable to specific work locations, within the San Francisco Bay area and New York City metropolitan area, and the base pay range for this role in those locations is USD $160,200 - $261,000 per year.",
].join(" ");

describe("parsePay", () => {
  it("keeps the general U.S. base range and the location-specific range", () => {
    const pay = parsePay(microsoft);
    expect(pay.payMin).toBe(119_800);
    expect(pay.payMax).toBe(234_700);
    expect(pay.payCurrency).toBe("USD");
    expect(pay.payPeriod).toBe("year");
    expect(pay.payKind).toBe("base");
    expect(pay.payRaw).toMatch(/across the U\.S\./);
    expect(pay.payRaw).not.toMatch(/San Francisco/);
    expect(pay.payRanges).toEqual([
      expect.objectContaining({
        min: 160_200,
        max: 261_000,
        currency: "USD",
        period: "year",
        scope: "location",
      }),
    ]);
  });

  it("reads a k range as annual dollars", () => {
    const pay = parsePay("Compensation for this role is $180k - $220k per year.");
    expect(pay).toMatchObject({
      payMin: 180_000,
      payMax: 220_000,
      payCurrency: "USD",
      payPeriod: "year",
    });
    expect(pay.payRanges).toEqual([]);
  });

  it("converts an hourly range to an annual salary", () => {
    const pay = parsePay("The posted rate is $45 - $60 per hour.");
    expect(pay.payMin).toBe(45 * HOURS_PER_YEAR);
    expect(pay.payMax).toBe(60 * HOURS_PER_YEAR);
    expect(pay.payPeriod).toBe("year");
    expect(pay.payRaw).toMatch(/per hour/i);
  });

  it("returns nulls when the posting does not state pay", () => {
    const pay = parsePay("Company: Northwind\nLevel: L64\nRequirements:\n- technical program management\n");
    expect(pay.payMin).toBeNull();
    expect(pay.payMax).toBeNull();
    expect(pay.payCurrency).toBeNull();
    expect(pay.payPeriod).toBeNull();
    expect(pay.payRaw).toBeNull();
    expect(pay.payRanges).toEqual([]);
  });
});
