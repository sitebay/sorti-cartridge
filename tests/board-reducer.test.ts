import { describe, expect, test } from "bun:test";
import { createBoard, NOTE_TEXT_MAX, type BoardAction } from "../examples/board/state.ts";
import { reduce } from "../examples/board/reducer.ts";

const board = () => createBoard({ runId: "b1", seed: 3 });

describe("createBoard", () => {
  test("is deterministic for the same args", () => {
    expect(createBoard({ runId: "b", seed: 4 })).toEqual(createBoard({ runId: "b", seed: 4 }));
  });

  test("starts empty on the board screen", () => {
    const state = board();
    expect(state.notes).toEqual([]);
    expect(state.screen_kind).toBe("board");
    expect(state.nextNoteId).toBe(1);
  });
});

describe("reduce", () => {
  test("add_note assigns deterministic ids, placement, and color", () => {
    const first = reduce(board(), { kind: "add_note", text: "alpha" });
    const again = reduce(board(), { kind: "add_note", text: "alpha" });
    expect(first.state).toEqual(again.state); // same seed → same placement
    const note = first.state.notes[0]!;
    expect(note.id).toBe("n1");
    expect(note.color).toBe("yellow");
    expect(first.events).toEqual([{ kind: "note_added", noteId: "n1" }]);
    // purity: input untouched
    expect(board().notes).toHaveLength(0);
  });

  test("add_note honors explicit position and clamps to the surface", () => {
    const { state } = reduce(board(), { kind: "add_note", text: "x", x: 99999, y: -50 });
    const note = state.notes[0]!;
    expect(note.x).toBe(state.width - 160);
    expect(note.y).toBe(0);
  });

  test("add_note rejects empty and oversized text", () => {
    expect(() => reduce(board(), { kind: "add_note", text: "   " })).toThrow(/non-empty/);
    expect(() =>
      reduce(board(), { kind: "add_note", text: "x".repeat(NOTE_TEXT_MAX + 1) }),
    ).toThrow(/exceeds/);
  });

  test("move_note moves and emits note_moved; unknown note throws", () => {
    const withNote = reduce(board(), { kind: "add_note", text: "a" }).state;
    const { state, events } = reduce(withNote, { kind: "move_note", noteId: "n1", x: 200, y: 100 });
    expect(state.notes[0]!).toMatchObject({ x: 200, y: 100 });
    expect(events).toEqual([{ kind: "note_moved", noteId: "n1", x: 200, y: 100 }]);
    expect(() => reduce(withNote, { kind: "move_note", noteId: "nope", x: 1, y: 1 })).toThrow(/unknown note/);
  });

  test("edit_note, set_color, remove_note round-trip", () => {
    let state = reduce(board(), { kind: "add_note", text: "a" }).state;
    state = reduce(state, { kind: "edit_note", noteId: "n1", text: "edited" }).state;
    expect(state.notes[0]!.text).toBe("edited");
    state = reduce(state, { kind: "set_color", noteId: "n1", color: "green" }).state;
    expect(state.notes[0]!.color).toBe("green");
    state = reduce(state, { kind: "remove_note", noteId: "n1" }).state;
    expect(state.notes).toEqual([]);
  });

  test("set_color rejects unknown colors", () => {
    const withNote = reduce(board(), { kind: "add_note", text: "a" }).state;
    expect(() =>
      reduce(withNote, { kind: "set_color", noteId: "n1", color: "mauve" as never }),
    ).toThrow(/unknown color/);
  });

  test("ids are never reused after removal", () => {
    let state = reduce(board(), { kind: "add_note", text: "a" }).state;
    state = reduce(state, { kind: "remove_note", noteId: "n1" }).state;
    state = reduce(state, { kind: "add_note", text: "b" }).state;
    expect(state.notes[0]!.id).toBe("n2");
  });

  test("replaying the action log reproduces the final state exactly", () => {
    const log: BoardAction[] = [
      { kind: "add_note", text: "plan" },
      { kind: "add_note", text: "build", x: 300, y: 200, color: "blue" },
      { kind: "move_note", noteId: "n1", x: 120, y: 80 },
      { kind: "edit_note", noteId: "n2", text: "build it" },
      { kind: "set_color", noteId: "n1", color: "pink" },
      { kind: "remove_note", noteId: "n2" },
    ];
    let live = board();
    for (const action of log) live = reduce(live, action).state;

    let replayed = board();
    for (const action of log) replayed = reduce(replayed, action).state;

    expect(replayed).toEqual(live);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));
  });
});
