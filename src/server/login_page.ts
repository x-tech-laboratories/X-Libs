// The page a browser signs in on with the server's access token: a page of its own, so signing in needs nothing from
// the app's built files, with colours that follow the light and dark themes.

export interface LoginPageOptions {
  // The app's name, shown as the heading and the tab title.
  title: string;
  // Whether the last try was refused, which adds a line saying so.
  has_failed?: boolean;
  // Where the form posts to; the login path itself unless set.
  action?: string;
  // The line under the heading.
  prompt?: string;
  // The line shown after a refused try.
  failure_text?: string;
}

function escape_html(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function render_login_page(options: LoginPageOptions): string {
  const title = escape_html(options.title);
  const action = escape_html(options.action ?? "login");
  const prompt = escape_html(options.prompt ?? "Enter the access token this server was set up with.");
  const failure_text = escape_html(options.failure_text ?? "That token is not right.");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
        --surface-root: #f1f5f9;
        --surface-default: #ffffff;
        --text-heading: #0f172a;
        --text-secondary: #475569;
        --border-control: #8792a3;
        --accent: #2563eb;
        --text-on-fill: #fff;
        --status-danger: #dc2626;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --surface-root: #060b14;
          --surface-default: #16213a;
          --text-heading: #f8fafc;
          --text-secondary: #cbd5e1;
          --border-control: #64748b;
          --accent: #60a5fa;
          --text-on-fill: #0b1220;
          --status-danger: #f87171;
        }
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 0 16px;
        background: var(--surface-root);
        color: var(--text-heading);
        font: 15px system-ui, sans-serif;
      }
      form {
        width: min(340px, 100%);
        display: grid;
        gap: 12px;
        padding: 24px;
        border-radius: 12px;
        background: var(--surface-default);
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
      }
      h1 { margin: 0; font-size: 20px; }
      p { margin: 0; color: var(--text-secondary); }
      .error { color: var(--status-danger); }
      input, button { font: inherit; padding: 8px 10px; border-radius: 8px; }
      input { border: 1px solid var(--border-control); background: transparent; color: inherit; }
      button { border: 0; background: var(--accent); color: var(--text-on-fill); cursor: pointer; }
    </style>
  </head>
  <body>
    <form method="post" action="${action}">
      <h1>${title}</h1>
      <p>${prompt}</p>
      ${options.has_failed ? `<p class="error">${failure_text}</p>` : ""}
      <input type="password" name="token" autocomplete="current-password" aria-label="Access token" autofocus required />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>
`;
}
