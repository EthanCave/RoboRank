import { describe, expect, it } from "vitest";

import {
  computeEventOpr,
  computeSeasonOpr,
  computeSkillsBests,
  computeTrueSkill,
  normalCdf,
  winProbability,
  type RatedMatch,
} from "./ratings";

let nextId = 1;
function match(red: string[], blue: string[], redScore: number, blueScore: number, extra: Partial<RatedMatch> = {}): RatedMatch {
  const id = nextId++;
  return { id, eventId: 1, round: 2, time: `2026-09-01T10:${String(id % 60).padStart(2, "0")}:00Z`, order: id, red, blue, redScore, blueScore, ...extra };
}

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });
});

describe("computeTrueSkill", () => {
  it("raises winners, lowers losers and shrinks uncertainty", () => {
    const ratings = computeTrueSkill([match(["A", "B"], ["C", "D"], 50, 20)]);
    const a = ratings.get("A")!;
    const c = ratings.get("C")!;
    expect(a.mu).toBeGreaterThan(25);
    expect(c.mu).toBeLessThan(25);
    expect(a.sigma).toBeLessThan(25 / 3);
    expect(a.wins).toBe(1);
    expect(c.losses).toBe(1);
    expect(a.trueskill).toBeCloseTo(a.mu - 3 * a.sigma, 10);
  });

  it("ranks a dominant team first after many matches", () => {
    const matches: RatedMatch[] = [];
    const others = ["B", "C", "D", "E", "F", "G"];
    for (let round = 0; round < 12; round += 1) {
      const partner = others[round % others.length];
      const opp = others.filter((team) => team !== partner).slice(round % 3, (round % 3) + 2);
      matches.push(match(["A", partner], opp, 80, 30));
    }
    const ratings = computeTrueSkill(matches);
    const sorted = [...ratings.values()].sort((x, y) => y.trueskill - x.trueskill);
    expect(sorted[0].teamNumber).toBe("A");
  });

  it("ignores practice and unplayed (0-0) matches", () => {
    const ratings = computeTrueSkill([
      match(["A", "B"], ["C", "D"], 40, 10, { round: 1 }),
      match(["A", "B"], ["C", "D"], 0, 0),
    ]);
    expect(ratings.size).toBe(0);
  });

  it("treats ties as draws that pull ratings together", () => {
    const ratings = computeTrueSkill([
      match(["A", "B"], ["C", "D"], 60, 10),
      match(["A", "B"], ["C", "D"], 30, 30),
    ]);
    expect(ratings.get("A")!.ties).toBe(1);
    const afterWin = computeTrueSkill([match(["A", "B"], ["C", "D"], 60, 10)]).get("A")!.mu;
    expect(ratings.get("A")!.mu).toBeLessThan(afterWin);
  });
});

describe("winProbability", () => {
  it("is 50% for equal unknown alliances and favors stronger ones", () => {
    expect(winProbability([undefined, undefined], [undefined, undefined])).toBeCloseTo(0.5, 6);
    const strong = { mu: 35, sigma: 2 };
    const weak = { mu: 18, sigma: 2 };
    expect(winProbability([strong, strong], [weak, weak])).toBeGreaterThan(0.9);
    expect(winProbability([weak, weak], [strong, strong])).toBeLessThan(0.1);
  });
});

describe("computeEventOpr", () => {
  it("recovers exact contributions when scores are additive", () => {
    const truth: Record<string, number> = { A: 30, B: 20, C: 10, D: 5, E: 15, F: 25 };
    const pairs: Array<[string[], string[]]> = [
      [["A", "B"], ["C", "D"]],
      [["A", "C"], ["E", "F"]],
      [["B", "D"], ["E", "A"]],
      [["C", "F"], ["B", "E"]],
      [["D", "F"], ["A", "C"]],
      [["E", "D"], ["F", "B"]],
      [["A", "F"], ["D", "B"]],
    ];
    const matches = pairs.map(([red, blue]) =>
      match(red, blue, red.reduce((s, t) => s + truth[t], 0), blue.reduce((s, t) => s + truth[t], 0)),
    );
    const rows = new Map(computeEventOpr(matches).map((row) => [row.teamNumber, row]));
    for (const [team, value] of Object.entries(truth)) {
      expect(rows.get(team)!.opr).toBeCloseTo(value, 1);
    }
    expect(rows.get("A")!.ccwm).toBeCloseTo(rows.get("A")!.opr - rows.get("A")!.dpr, 10);
  });

  it("only uses qualification matches", () => {
    expect(computeEventOpr([match(["A", "B"], ["C", "D"], 40, 20, { round: 3 })])).toEqual([]);
  });

  it("averages event OPRs weighted by matches for the season", () => {
    const e1 = [match(["A", "B"], ["C", "D"], 40, 20, { eventId: 1 })];
    const e2 = [match(["A", "C"], ["B", "D"], 60, 20, { eventId: 2 }), match(["A", "D"], ["B", "C"], 60, 20, { eventId: 2 })];
    const season = computeSeasonOpr([...e1, ...e2]);
    expect(season.get("A")!.matches).toBe(3);
  });
});

describe("computeSkillsBests", () => {
  it("combines driver and programming from the same event", () => {
    const best = computeSkillsBests([
      { eventId: 1, teamNumber: "A", type: "driver", score: 30 },
      { eventId: 1, teamNumber: "A", type: "driver", score: 40 },
      { eventId: 1, teamNumber: "A", type: "programming", score: 20 },
      { eventId: 2, teamNumber: "A", type: "driver", score: 55 },
      { eventId: 2, teamNumber: "A", type: "package_driver", score: 99 },
    ]);
    expect(best.get("A")).toMatchObject({ eventId: 1, driver: 40, programming: 20, combined: 60 });
  });
});
