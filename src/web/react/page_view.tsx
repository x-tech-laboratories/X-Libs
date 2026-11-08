// A full-window page over the app, such as Settings or an item's properties, on the Dialog so Escape and Close always lead back out; its section tabs stay put while the body scrolls.

import type { ReactNode } from "react";
import { Dialog } from "./dialog.tsx";
import { Tabs, type TabItem } from "./layout.tsx";

export type { TabItem } from "./layout.tsx";

interface PageViewProps<Section extends string> {
  title: string;
  subtitle?: ReactNode;
  on_close: () => void;
  // Buttons beside Close, such as Merge.
  actions?: ReactNode;
  // The page's sections as tabs under the title, chosen through on_section.
  sections?: TabItem<Section>[];
  section?: Section;
  on_section?: (section: Section) => void;
  close_label?: string;
  class_name?: string;
  children: ReactNode;
}

export function PageView<Section extends string>({ title, subtitle, on_close, actions, sections, section, on_section, close_label = "Close", class_name, children }: PageViewProps<Section>) {
  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      on_close={on_close}
      full
      class_name={class_name ? `page-view ${class_name}` : "page-view"}
      actions={<>{actions}<button type="button" onClick={on_close} title={`${close_label} (Esc)`}>{close_label}</button></>}
    >
      {sections && section !== undefined && <Tabs label={`${title} sections`} items={sections} active={section} on_select={on_section} />}
      {children}
    </Dialog>
  );
}
