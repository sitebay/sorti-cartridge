/**
 * Sticky Board reducer — THE one mutation path (PANEL-AUTHORING.md §9).
 *
 * Pure function: never mutates the input state, never touches the clock or
 * entropy, throws on illegal actions (the MCP layer converts throws into
 * `isError` tool results). Replaying the action log through `reduce` from
 * `createBoard(...)` reproduces the final state exactly.
 */

import {
  cloneBoard,
  NOTE_COLORS,
  NOTE_TEXT_MAX,
  type BoardAction,
  type BoardEvent,
  type BoardState,
  type Note,
  type NoteColor,
} from "./state.ts";

export interface ReduceResult {
  state: BoardState;
  events: BoardEvent[];
}

const NOTE_W = 160; // nominal note footprint used for clamping + placement
const NOTE_H = 120;

export function reduce(state: BoardState, action: BoardAction): ReduceResult {
  switch (action.kind) {
    case "add_note":
      return addNote(state, action);
    case "move_note":
      return moveNote(state, action);
    case "edit_note":
      return editNote(state, action);
    case "remove_note":
      return removeNote(state, action);
    case "set_color":
      return setColor(state, action);
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Convenience for client-side prediction bundles. */
export function reduceOne(state: BoardState, action: BoardAction): ReduceResult {
  return reduce(state, action);
}

function addNote(
  state: BoardState,
  action: { text: string; x?: number; y?: number; color?: NoteColor },
): ReduceResult {
  const text = requireText(action.text);
  const color = action.color ?? NOTE_COLORS[(state.nextNoteId - 1) % NOTE_COLORS.length]!;
  if (!NOTE_COLORS.includes(color)) throw new Error(`unknown color: ${String(color)}`);

  const next = cloneBoard(state);
  const n = next.nextNoteId;
  // Deterministic cascade placement when the caller doesn't position the note.
  const fallbackX = 32 + ((next.seed * 17 + n * 48) % (next.width - NOTE_W - 64));
  const fallbackY = 32 + ((n * 56) % (next.height - NOTE_H - 64));
  const note: Note = {
    id: `n${n}`,
    text,
    x: clamp(action.x ?? fallbackX, 0, next.width - NOTE_W),
    y: clamp(action.y ?? fallbackY, 0, next.height - NOTE_H),
    color,
  };
  next.notes.push(note);
  next.nextNoteId += 1;
  next.opCount += 1;
  return { state: next, events: [{ kind: "note_added", noteId: note.id }] };
}

function moveNote(state: BoardState, action: { noteId: string; x: number; y: number }): ReduceResult {
  if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) {
    throw new Error("move_note requires numeric x and y");
  }
  const next = cloneBoard(state);
  const note = requireNote(next, action.noteId);
  note.x = clamp(action.x, 0, next.width - NOTE_W);
  note.y = clamp(action.y, 0, next.height - NOTE_H);
  next.opCount += 1;
  return { state: next, events: [{ kind: "note_moved", noteId: note.id, x: note.x, y: note.y }] };
}

function editNote(state: BoardState, action: { noteId: string; text: string }): ReduceResult {
  const text = requireText(action.text);
  const next = cloneBoard(state);
  const note = requireNote(next, action.noteId);
  note.text = text;
  next.opCount += 1;
  return { state: next, events: [{ kind: "note_edited", noteId: note.id }] };
}

function removeNote(state: BoardState, action: { noteId: string }): ReduceResult {
  const next = cloneBoard(state);
  const index = next.notes.findIndex((note) => note.id === action.noteId);
  if (index < 0) throw new Error(`unknown note: ${action.noteId}`);
  next.notes.splice(index, 1);
  next.opCount += 1;
  return { state: next, events: [{ kind: "note_removed", noteId: action.noteId }] };
}

function setColor(state: BoardState, action: { noteId: string; color: NoteColor }): ReduceResult {
  if (!NOTE_COLORS.includes(action.color)) throw new Error(`unknown color: ${String(action.color)}`);
  const next = cloneBoard(state);
  const note = requireNote(next, action.noteId);
  note.color = action.color;
  next.opCount += 1;
  return { state: next, events: [{ kind: "note_recolored", noteId: note.id, color: note.color }] };
}

function requireNote(state: BoardState, noteId: string): Note {
  const note = state.notes.find((candidate) => candidate.id === noteId);
  if (!note) throw new Error(`unknown note: ${noteId}`);
  return note;
}

function requireText(raw: string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new Error("note text must be non-empty");
  if (text.length > NOTE_TEXT_MAX) throw new Error(`note text exceeds ${NOTE_TEXT_MAX} chars`);
  return text;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
