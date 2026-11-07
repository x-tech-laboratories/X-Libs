import { describe, expect, test, vi } from "vitest";

import { bring_to_front, first_argument, hold_single_instance, type AppLike, type FocusableWindowLike } from "../../src/electron/app.ts";

// An app whose lock is held or not, keeping the second-instance listener it is given.
function fake_app(has_lock: boolean) {
  let second_instance: ((event: unknown, argv: string[]) => void) | undefined;
  const app: AppLike = {
    requestSingleInstanceLock: () => has_lock,
    quit: vi.fn(),
    on: (_event, listener) => { second_instance = listener; },
  };
  return { app, launch_again: (argv: string[]) => second_instance?.({}, argv) };
}

describe("single instance", () => {
  test("the first copy keeps running and hears a second launch's command line", () => {
    const { app, launch_again } = fake_app(true);
    const on_second_launch = vi.fn();

    expect(hold_single_instance(app, on_second_launch)).toBe(true);
    launch_again(["x-tasks", "x-tasks://task/7"]);

    expect(app.quit).not.toHaveBeenCalled();
    expect(on_second_launch).toHaveBeenCalledWith(["x-tasks", "x-tasks://task/7"]);
  });

  test("a second copy quits", () => {
    const { app } = fake_app(false);

    expect(hold_single_instance(app, () => {})).toBe(false);
    expect(app.quit).toHaveBeenCalled();
  });
});

describe("window and command line", () => {
  test("restores a minimised window before focusing it", () => {
    const calls: string[] = [];
    const window = (minimised: boolean): FocusableWindowLike => ({ isMinimized: () => minimised, restore: () => calls.push("restore"), focus: () => calls.push("focus") });

    bring_to_front(window(true));
    bring_to_front(window(false));

    expect(calls).toEqual(["restore", "focus", "focus"]);
  });

  test("finds the first argument the parser accepts", () => {
    const task_id = (argument: string) => argument.match(/^x-tasks:\/\/task\/(\w+)$/)?.[1] ?? null;

    expect(first_argument(["x-tasks", "--flag", "x-tasks://task/7", "x-tasks://task/8"], task_id)).toBe("7");
    expect(first_argument(["x-tasks"], task_id)).toBeNull();
  });
});
