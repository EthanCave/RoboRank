import { randomUUID } from "node:crypto";

import { getDb } from "./db.server";
import { normalizeTeamNumber } from "./teams";

export type ScoutingNote = {
  id: string;
  teamNumber: string;
  authorName: string;
  subject: string;
  strengths: string;
  concerns: string;
  createdAt: string;
};

type ScoutingNoteRow = {
  id: string;
  team_number: string;
  author_name: string;
  subject: string;
  strengths: string;
  concerns: string;
  created_at: string;
};

function toScoutingNote(row: ScoutingNoteRow): ScoutingNote {
  return {
    id: row.id,
    teamNumber: row.team_number,
    authorName: row.author_name,
    subject: row.subject,
    strengths: row.strengths,
    concerns: row.concerns,
    createdAt: row.created_at,
  };
}

export function listNotesForTeam(teamNumber: string, limit = 40): ScoutingNote[] {
  const rows = getDb()
    .prepare("SELECT * FROM scouting_notes WHERE team_number = ? ORDER BY created_at DESC LIMIT ?")
    .all(normalizeTeamNumber(teamNumber), limit) as ScoutingNoteRow[];
  return rows.map(toScoutingNote);
}

export function countNotesByTeam(teamNumbers: string[]): Map<string, number> {
  if (!teamNumbers.length) return new Map();
  const placeholders = teamNumbers.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT team_number, COUNT(*) AS n FROM scouting_notes WHERE team_number IN (${placeholders}) GROUP BY team_number`)
    .all(...teamNumbers.map(normalizeTeamNumber)) as Array<{ team_number: string; n: number }>;
  return new Map(rows.map((row) => [row.team_number, row.n]));
}

export function addScoutingNote(input: Omit<ScoutingNote, "id" | "createdAt">): ScoutingNote {
  const note: ScoutingNote = {
    id: randomUUID(),
    teamNumber: normalizeTeamNumber(input.teamNumber),
    authorName: input.authorName.trim() || "Team",
    subject: input.subject.trim(),
    strengths: input.strengths.trim(),
    concerns: input.concerns.trim(),
    createdAt: new Date().toISOString(),
  };

  if (!note.teamNumber || !note.subject || (!note.strengths && !note.concerns)) {
    throw new Error("Add a subject and at least one of strengths or concerns.");
  }

  getDb()
    .prepare(
      `INSERT INTO scouting_notes (id, team_number, author_name, subject, strengths, concerns, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(note.id, note.teamNumber, note.authorName, note.subject, note.strengths, note.concerns, note.createdAt);
  return note;
}

export function deleteScoutingNote(id: string) {
  getDb().prepare("DELETE FROM scouting_notes WHERE id = ?").run(id);
}

export function listMatchNotes(eventId: number, teamNumber: string): Map<number, string> {
  const rows = getDb()
    .prepare("SELECT match_id, note FROM match_notes WHERE event_id = ? AND team_number = ?")
    .all(eventId, normalizeTeamNumber(teamNumber)) as Array<{ match_id: number; note: string }>;
  return new Map(rows.map((row) => [row.match_id, row.note]));
}

/** One shared note per (event, match, our team); an empty note deletes it. */
export function saveMatchNote(input: { eventId: number; matchId: number; teamNumber: string; authorName: string; note: string }) {
  const teamNumber = normalizeTeamNumber(input.teamNumber);
  if (!Number.isFinite(input.eventId) || !Number.isFinite(input.matchId) || !teamNumber) {
    throw new Error("Missing event, match, or team.");
  }

  const db = getDb();
  const note = input.note.trim();
  if (!note) {
    db.prepare("DELETE FROM match_notes WHERE event_id = ? AND match_id = ? AND team_number = ?").run(input.eventId, input.matchId, teamNumber);
    return;
  }

  db.prepare(
    `INSERT INTO match_notes (event_id, match_id, team_number, author_name, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, match_id, team_number) DO UPDATE SET note = excluded.note, author_name = excluded.author_name, updated_at = excluded.updated_at`,
  ).run(input.eventId, input.matchId, teamNumber, input.authorName, note, new Date().toISOString());
}
