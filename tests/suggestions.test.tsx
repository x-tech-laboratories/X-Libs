// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Suggestions } from "../src/web/react/suggestions.tsx";

afterEach(cleanup);

interface Command { name: string; usage: string; description: string }

const commands: Command[] = [
  { name: "answer", usage: "/answer request", description: "Answer mode" },
  { name: "draft", usage: "/draft request", description: "Draft mode" },
  { name: "do", usage: "/do request", description: "Execute mode" },
];

// Completions for the first word of the text, as slash commands are.
const source = (value: string): Command[] => value.startsWith("/") && !/\s/.test(value) ? commands.filter((command) => command.name.startsWith(value.slice(1))) : [];

function Box({ on_take, on_key_down }: { on_take: (command: Command) => void; on_key_down?: () => void }) {
  return (
    <Suggestions<Command, HTMLTextAreaElement> value="/d" source={source} key_of={(command) => command.name} render={(command) => command.usage} detail={(command) => command.description} on_take={on_take} label="Commands" on_key_down={on_key_down}>
      {(field) => <textarea aria-label="Your request" defaultValue="/d" {...field} />}
    </Suggestions>
  );
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

test("lists what the text could become, arrows pick one, and Tab takes it", async () => {
  const on_take = vi.fn();
  render(<Box on_take={on_take} />);
  await settle();

  const field = screen.getByRole("textbox", { name: "Your request" });
  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["/draft requestDraft mode", "/do requestExecute mode"]);
  expect(options[0]!.getAttribute("aria-selected")).toBe("true");
  expect(field.getAttribute("aria-activedescendant")).toBe(options[0]!.id);

  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(field, { key: "Tab" });

  expect(on_take).toHaveBeenCalledWith(commands[2]);
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("Escape dismisses the list, a click takes one, and other keys pass through", async () => {
  const on_take = vi.fn();
  const on_key_down = vi.fn();
  render(<Box on_take={on_take} on_key_down={on_key_down} />);
  await settle();
  const field = screen.getByRole("textbox", { name: "Your request" });

  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  expect(on_key_down).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(screen.getByRole("option", { name: /draft/ }));
  expect(on_take).toHaveBeenCalledWith(commands[1]);

  expect(screen.queryByRole("listbox")).toBeNull();
});
