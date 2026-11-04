import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const NOTES_FILE = path.join(process.cwd(), "app", "data", "competition-notes.json");

export type CompetitionMatchNote = {
  id: string;
  eventId: number;
  teamNumber: string;
  matchId: number;
  authorId: string;
  authorName: string;
  note: string;
  createdAt: string;
};

type NewCompetitionNote = {
  eventId: number;
  teamNumber: string;
  matchId: number;
  authorId: string;
  authorName: string;
  note: string;
};

function normalizeTeamNumber(value: string) {
  return value.trim().toUpperCase();
}

async function ensureFile() {
  await mkdir(path.dirname(NOTES_FILE), { recursive: true });

  try {
    await access(NOTES_FILE);
  } catch {
    await writeFile(NOTES_FILE, "[]\n", "utf8");
  }
}

async function readNotes(): Promise<CompetitionMatchNote[]> {
  await ensureFile();

  try {
    const raw = await readFile(NOTES_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is CompetitionMatchNote => {
      return (
        typeof entry?.id === "string" &&
        typeof entry?.eventId === "number" &&
        typeof entry?.teamNumber === "string" &&
        typeof entry?.matchId === "number" &&
        typeof entry?.authorId === "string" &&
        typeof entry?.authorName === "string" &&
        typeof entry?.note === "string" &&
        typeof entry?.createdAt === "string"
      );
    });
  } catch {
    return [];
  }
}

async function writeNotes(notes: CompetitionMatchNote[]) {
  await ensureFile();
  await writeFile(NOTES_FILE, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
}

export async function listCompetitionNotesForEventTeam(eventId: number, teamNumber: string) {
  const normalized = normalizeTeamNumber(teamNumber);
  const notes = await readNotes();

  return notes
    .filter((entry) => entry.eventId === eventId && entry.teamNumber === normalized)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function upsertCompetitionMatchNote(input: NewCompetitionNote) {
  const note = input.note.trim();
  const teamNumber = normalizeTeamNumber(input.teamNumber);

  if (!note || !teamNumber || !Number.isFinite(input.eventId) || !Number.isFinite(input.matchId)) {
    throw new Error("Event, team, match, and note text are required.");
  }

  const notes = await readNotes();
  const existingIndex = notes.findIndex((entry) => {
    return (
      entry.eventId === input.eventId &&
      entry.teamNumber === teamNumber &&
      entry.matchId === input.matchId &&
      entry.authorId === input.authorId
    );
  });

  const base: CompetitionMatchNote = {
    id: randomUUID(),
    eventId: input.eventId,
    teamNumber,
    matchId: input.matchId,
    authorId: input.authorId,
    authorName: input.authorName,
    note,
    createdAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    notes[existingIndex] = {
      ...notes[existingIndex],
      note,
      createdAt: base.createdAt,
      authorName: input.authorName,
    };
    await writeNotes(notes);
    return notes[existingIndex];
  }

  notes.push(base);
  await writeNotes(notes);
  return base;
}
