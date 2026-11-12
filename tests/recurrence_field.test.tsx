// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import { read_features, RecurrenceField } from "../src/web/react/recurrence.tsx";

afterEach(cleanup);

function Rule({ initial = "", ...props }: { initial?: string } & Omit<Parameters<typeof RecurrenceField>[0], "value" | "on_change">) {
  const [value, set_value] = useState(initial);
  return (
    <form>
      <RecurrenceField value={value} on_change={set_value} {...props} />
      <output data-testid="value">{value}</output>
      <button type="button" onClick={() => set_value("FREQ=YEARLY;BYMONTH=3")}>Load</button>
    </form>
  );
}

function value(): string {
  return screen.getByTestId("value").textContent ?? "";
}

function select(name: string, option: string): void {
  fireEvent.change(screen.getByRole("combobox", { name }), { target: { value: option } });
}

test("reads feature presets with names added and taken away", () => {
  expect([...read_features("simple times")]).toEqual(["times"]);
  expect(read_features("").has("more-options")).toBe(false);
  expect(read_features("full").has("more-options")).toBe(true);
  expect(read_features("standard -sub-daily").has("sub-daily")).toBe(false);
});

test("starts repeating daily and stops with the switch", () => {
  render(<Rule />);
  const repeats = screen.getByRole("checkbox", { name: "Repeats" });

  fireEvent.click(repeats);
  expect(value()).toBe("FREQ=DAILY");
  expect(screen.getByText("Every day")).toBeTruthy();

  fireEvent.click(repeats);
  expect(value()).toBe("");
  expect(screen.queryByRole("combobox", { name: "Unit" })).toBeNull();
});

test("picks weekdays for a weekly rule", () => {
  render(<Rule initial="FREQ=DAILY" />);

  select("Unit", "WEEKLY");
  fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
  fireEvent.click(screen.getByRole("button", { name: "Monday" }));
  expect(value()).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
  expect(screen.getByRole("button", { name: "Monday" }).getAttribute("aria-pressed")).toBe("true");
});

test("builds a monthly rule on a weekday entry from the start's day", () => {
  render(<Rule initial="FREQ=MONTHLY" start="2026-06-26" />);

  select("Which days", "weekdays");
  expect(value()).toBe("FREQ=MONTHLY;BYDAY=+4FR");

  select("Which", "-1");
  expect(value()).toBe("FREQ=MONTHLY;BYDAY=-1FR");
  expect(screen.getByText("Every month on the last Friday")).toBeTruthy();
});

test("gives a yearly day pattern the start's month so it never means every month", () => {
  render(<Rule initial="FREQ=YEARLY" start="2026-06-26" />);

  select("Which days", "days");
  expect(value()).toBe("FREQ=YEARLY;BYMONTHDAY=26;BYMONTH=6");

  fireEvent.click(screen.getByRole("button", { name: "June" }));
  expect(value()).toBe("FREQ=YEARLY;BYMONTHDAY=26;BYMONTH=6");
});

test("keeps a day list it cannot read as typed and blocks the form", () => {
  render(<Rule initial="FREQ=MONTHLY;BYMONTHDAY=15" />);
  const days = screen.getByRole("textbox", { name: "Days of the month, -1 for the last" }) as HTMLInputElement;

  fireEvent.change(days, { target: { value: "15, 40" } });
  fireEvent.blur(days);
  expect(days.value).toBe("15, 40");
  expect(days.validationMessage).toContain("BYMONTHDAY takes whole numbers");
  expect(document.querySelector("form")!.checkValidity()).toBe(false);
  expect(value()).toBe("FREQ=MONTHLY;BYMONTHDAY=15");

  fireEvent.change(days, { target: { value: "15, -1" } });
  fireEvent.keyDown(days, { key: "Enter" });
  expect(value()).toBe("FREQ=MONTHLY;BYMONTHDAY=15,-1");
  expect(document.querySelector("form")!.checkValidity()).toBe(true);
});

test("adds times that share their minutes and refuses ones that do not", () => {
  render(<Rule initial="FREQ=DAILY" />);

  fireEvent.click(screen.getByRole("button", { name: "Add a time" }));
  expect(value()).toBe("FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
  fireEvent.click(screen.getByRole("button", { name: "Add a time" }));
  expect(value()).toBe("FREQ=DAILY;BYHOUR=9,10;BYMINUTE=0");

  const times = screen.getAllByLabelText("Time") as HTMLInputElement[];
  fireEvent.change(times[1]!, { target: { value: "10:30" } });
  expect(times[1]!.value).toBe("10:30");
  expect(document.querySelector("form")!.checkValidity()).toBe(false);
  expect(value()).toBe("FREQ=DAILY;BYHOUR=9,10;BYMINUTE=0");
});

test("ends after a number of times or on a date", () => {
  render(<Rule initial="FREQ=DAILY" time_mode="floating" />);

  select("How it ends", "count");
  expect(value()).toBe("FREQ=DAILY;COUNT=1");

  select("How it ends", "until");
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-12-31T23:59" } });
  expect(value()).toBe("FREQ=DAILY;UNTIL=20261231T235900");
});

test("skips and adds dates as iCalendar lines", () => {
  render(<Rule initial="RRULE:FREQ=DAILY" value_format="ical" all_day />);

  fireEvent.click(screen.getByRole("button", { name: "Skip a date" }));
  fireEvent.change(screen.getByLabelText("Date to skip"), { target: { value: "2026-07-04" } });
  expect(value()).toBe("RRULE:FREQ=DAILY\nEXDATE;VALUE=DATE:20260704");

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(value()).toBe("RRULE:FREQ=DAILY");
});

test("shows only the simple form's controls", () => {
  render(<Rule initial="FREQ=DAILY" features="simple" />);

  expect(screen.queryByRole("button", { name: "Add a time" })).toBeNull();
  expect(screen.getAllByLabelText("Time")).toHaveLength(1);
  expect(screen.queryByRole("option", { name: "hour(s)" })).toBeNull();
  expect(screen.queryByText("More options")).toBeNull();
});

test("edits any BY part under More options", () => {
  render(<Rule initial="FREQ=YEARLY" features="full" />);
  const weeks = screen.getByRole("textbox", { name: "BYWEEKNO" });

  fireEvent.change(weeks, { target: { value: "1, 20" } });
  fireEvent.blur(weeks);
  expect(value()).toBe("FREQ=YEARLY;BYWEEKNO=1,20");

  select("Week starts on", "SU");
  expect(value()).toBe("FREQ=YEARLY;BYWEEKNO=1,20;WKST=SU");
});

test("keeps a value it cannot read until edited, blocking the form meanwhile", () => {
  render(<Rule initial="FREQ=SOMETIMES" />);
  const repeats = screen.getByRole("checkbox", { name: "Repeats" }) as HTMLInputElement;

  expect(screen.getByText(/not a recurrence rule the form can read/)).toBeTruthy();
  expect(repeats.validity.customError).toBe(true);
  expect(value()).toBe("FREQ=SOMETIMES");

  fireEvent.click(repeats);
  expect(value()).toBe("");
  expect(repeats.validity.customError).toBe(false);
});

test("keeps a rule in another calendar as written and only turns it off", () => {
  render(<Rule initial="RSCALE=HEBREW;FREQ=YEARLY;BYMONTH=5" />);

  expect(screen.getByText(/uses RSCALE=HEBREW, which this form cannot edit/)).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Unit" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Repeats" }));
  expect(value()).toBe("");
});

test("follows a value set from outside and submits under its name", () => {
  render(<Rule initial="FREQ=DAILY" name="rrule" />);

  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  expect((screen.getByRole("combobox", { name: "Unit" }) as HTMLSelectElement).value).toBe("YEARLY");
  expect(new FormData(document.querySelector("form")!).get("rrule")).toBe("FREQ=YEARLY;BYMONTH=3");
});

test("disables every control", () => {
  render(<Rule initial="FREQ=WEEKLY" disabled />);

  expect((screen.getByRole("button", { name: "Monday" }) as HTMLButtonElement).matches(":disabled")).toBe(true);
});
