// Draws a site's ```mermaid blocks with mermaid, coloured by Halon's tokens for the scheme the page shows. The site's
// browser entry hands in its own import of mermaid, so X-App never needs it and sites without diagrams never load it.

// ── Shapes ───────────────────────────────────────────────────────────────────

// The part of mermaid the drawer uses.
export interface MermaidModule {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

// Turns a diagram's source into its SVG, for a dark or a light page.
export type DiagramDrawer = (source: string, dark: boolean) => Promise<string>;

// ── Colours ──────────────────────────────────────────────────────────────────

// Mermaid's theme variables from the page's Halon tokens, as the current scheme sets them.
export function mermaid_theme(read: (token: string) => string, dark: boolean): Record<string, unknown> {
  const surface = read("--surface-default") || (dark ? "#16213a" : "#ffffff");
  const panel = read("--surface-secondary") || (dark ? "#060b14" : "#f1f5f9");
  const text = read("--text-body") || (dark ? "#e2e8f0" : "#1a1a2e");
  const muted = read("--text-secondary") || (dark ? "#cbd5e1" : "#475569");
  const border = read("--border-default") || (dark ? "#334155" : "#e2e8f0");
  return {
    darkMode: dark,
    background: surface,
    fontFamily: read("--font-family-interface") || "Noto Sans, sans-serif",
    fontSize: "14px",
    primaryColor: panel,
    primaryTextColor: text,
    primaryBorderColor: muted,
    secondaryColor: surface,
    tertiaryColor: panel,
    lineColor: muted,
    textColor: text,
    mainBkg: panel,
    nodeBorder: muted,
    clusterBkg: surface,
    clusterBorder: border,
    edgeLabelBackground: surface,
    noteBkgColor: panel,
    noteTextColor: text,
    noteBorderColor: border,
    actorBkg: panel,
    actorBorder: muted,
    actorTextColor: text,
    signalColor: text,
    signalTextColor: text,
    labelBoxBkgColor: panel,
    labelTextColor: text,
  };
}

// ── Drawing ──────────────────────────────────────────────────────────────────

// A drawer that loads mermaid on its first diagram and sets its colours again whenever the scheme changes; diagrams
// are drawn one at a time, since mermaid's settings are shared by every diagram.
export function mermaid_drawer(load: () => Promise<{ default: MermaidModule }>): DiagramDrawer {
  let loading: Promise<MermaidModule> | null = null;
  let scheme: boolean | null = null;
  let count = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const draw = async (source: string, dark: boolean): Promise<string> => {
    loading ??= load().then((module) => module.default);
    const mermaid = await loading;
    if (scheme !== dark) {
      const styles = getComputedStyle(document.documentElement);
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: mermaid_theme((token) => styles.getPropertyValue(token).trim(), dark) });
      scheme = dark;
    }
    count += 1;
    const { svg } = await mermaid.render(`site-diagram-${count}`, source);
    return svg;
  };

  return (source, dark) => {
    const next = queue.then(() => draw(source, dark));
    queue = next.catch(() => {});
    return next;
  };
}
