import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const NOTES_FILE = path.join(process.cwd(), "app", "data", "scouting-notes.json");

export type ScoutingNote = {
  id: string;
  teamNumber: string;
  authorId: string;
  authorName: string;
  subject: string;
  strengths: string;
  concerns: string;
  createdAt: string;
};

type NewNote = {
  teamNumber: string;
  authorId: string;
  authorName: string;
  subject: string;
  strengths: string;
  concerns: string;
};

function normalizeTeamNumber(teamNumber: string) {
  return teamNumber.trim().toUpperCase();
}

async function ensureNotesFile() {
  await mkdir(path.dirname(NOTES_FILE), { recursive: true });

  try {
    await access(NOTES_FILE);
  } catch {
    await writeFile(NOTES_FILE, "[]\n", "utf8");
  }
}

async function readNotes(): Promise<ScoutingNote[]> {
  await ensureNotesFile();

  try {
    const raw = await readFile(NOTES_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];

    return data.filter((entry): entry is ScoutingNote => {
      return (
        typeof entry?.id === "string" &&
        typeof entry?.teamNumber === "string" &&
        typeof entry?.authorId === "string" &&
        typeof entry?.authorName === "string" &&
        typeof entry?.subject === "string" &&
        typeof entry?.strengths === "string" &&
        typeof entry?.concerns === "string" &&
        typeof entry?.createdAt === "string"
      );
    });
  } catch {
    return [];
  }
}

async function writeNotes(notes: ScoutingNote[]) {
  await ensureNotesFile();
  await writeFile(NOTES_FILE, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
}

export async function listNotesForTeam(teamNumber: string, limit = 40): Promise<ScoutingNote[]> {
  const normalized = normalizeTeamNumber(teamNumber);
  if (!normalized) return [];

  const notes = await readNotes();
  return notes
    .filter((note) => note.teamNumber === normalized)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function addScoutingNote(input: NewNote): Promise<ScoutingNote> {
  const subject = input.subject.trim();
  const strengths = input.strengths.trim();
  const concerns = input.concerns.trim();
  const teamNumber = normalizeTeamNumber(input.teamNumber);

  if (!teamNumber || !subject || !strengths || !concerns) {
    throw new Error("All scouting note fields are required.");
  }

  const notes = await readNotes();
  const created: ScoutingNote = {
    id: randomUUID(),
    teamNumber,
    authorId: input.authorId,
    authorName: input.authorName,
    subject,
    strengths,
    concerns,
    createdAt: new Date().toISOString(),
  };

  notes.push(created);
  await writeNotes(notes);
  return created;
}
