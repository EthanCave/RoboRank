import { describe, expect, it } from "vitest";

import { allianceCountFor, bracketOrder, generateSchedule, mulberry32, selectAlliances, simulateEvent, type SimTeam, type Standing } from "./simulation";

const teams = (n: number): SimTeam[] =>
  Array.from({ length: n }, (_, i) => ({ teamNumber: `T${i + 1}`, mu: 40 - i, sigma: 1, opr: 30 - i }));

describe("bracketOrder", () => {
  it("keeps top seeds apart until the final", () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketOrder(2)).toEqual([1, 2]);
  });
});

describe("allianceCountFor", () => {
  it("uses 16 alliances for big events and fewer for small ones", () => {
    expect(allianceCountFor(40)).toBe(16);
    expect(allianceCountFor(20)).toBe(8);
    expect(allianceCountFor(6)).toBe(3);
  });
});

describe("generateSchedule", () => {
  it("gives every team the requested number of matches with four distinct teams each", () => {
    const names = teams(12).map((t) => t.teamNumber);
    const schedule = generateSchedule(names, 6, mulberry32(7));
    const counts = new Map<string, number>();
    for (const match of schedule) {
      expect(new Set([...match.red, ...match.blue]).size).toBe(4);
      for (const team of [...match.red, ...match.blue]) counts.set(team, (counts.get(team) ?? 0) + 1);
    }
    for (const name of names) expect(counts.get(name)).toBe(6);
  });
});

describe("selectAlliances", () => {
  it("lets each captain pick the strongest available team", () => {
    const standings: Standing[] = ["A", "B", "C", "D"].map((teamNumber, i) => ({ teamNumber, rank: i + 1, wp: 0, sp: 0, wins: 0, losses: 0, ties: 0 }));
    const strength: Record<string, number> = { A: 30, B: 20, C: 35, D: 10 };
    const alliances = selectAlliances(standings, (t) => strength[t], 2);
    // C is stronger than A but outside the remaining captain slot, so it accepts.
    expect(alliances[0].teams).toEqual(["A", "C"]);
    expect(alliances[1].teams).toEqual(["B", "D"]);
  });

  it("lets a stronger would-be captain decline", () => {
    const standings: Standing[] = ["A", "B", "C", "D"].map((teamNumber, i) => ({ teamNumber, rank: i + 1, wp: 0, sp: 0, wins: 0, losses: 0, ties: 0 }));
    const strength: Record<string, number> = { A: 10, B: 30, C: 20, D: 5 };
    const alliances = selectAlliances(standings, (t) => strength[t], 2);
    expect(alliances[0].teams).toEqual(["A", "C"]);
    expect(alliances[1].teams).toEqual(["B", "D"]);
  });
});

describe("simulateEvent", () => {
  it("is reproducible for a seed and favors the strongest team", () => {
    const input = { teams: teams(16), schedule: [], iterations: 200, seed: 42 };
    const a = simulateEvent(input)!;
    const b = simulateEvent(input)!;
    expect(a.odds).toEqual(b.odds);
    // The two strongest teams usually ally, so they share the top champion odds.
    expect(a.odds.slice(0, 2).map((row) => row.teamNumber).sort()).toEqual(["T1", "T2"]);
    const totalChampion = a.odds.reduce((sum, row) => sum + row.champion, 0);
    expect(totalChampion).toBeCloseTo(2, 5); // two teams per winning alliance
  });

  it("keeps already-played results fixed", () => {
    const list = teams(4);
    const result = simulateEvent({
      teams: list,
      schedule: [{ id: 1, red: ["T4", "T3"], blue: ["T1", "T2"], result: { redScore: 100, blueScore: 0 } }],
      iterations: 50,
      seed: 1,
    })!;
    expect(result.playedMatches).toBe(1);
    expect(result.sample.standings.slice(0, 2).map((s) => s.teamNumber).sort()).toEqual(["T3", "T4"]);
  });

  it("needs at least four teams", () => {
    expect(simulateEvent({ teams: teams(3), schedule: [] })).toBeNull();
  });
});
