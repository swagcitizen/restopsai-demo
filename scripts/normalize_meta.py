#!/usr/bin/env python3
"""Idempotent meta-tag normalization across Stationly pages.

For each HTML in repo root:
  - ensure <meta name="description" ...>
  - ensure <meta name="theme-color" content="#faf5ea">
  - ensure <link rel="apple-touch-icon" ...> (same SVG as favicon)
  - ensure og:title/og:description on PUBLIC pages only

Insertion point: right after the favicon <link rel="icon" ...> line.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAVICON_SVG = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
    "%3Crect width='64' height='64' rx='14' fill='%23e8a33d'/%3E"
    "%3Cpath d='M20 22 Q20 14 32 14 Q44 14 44 22 L44 24 Q44 28 36 28 L28 28 Q20 28 20 34 "
    "Q20 40 28 40 L36 40 Q44 40 44 44 L44 46 Q44 54 32 54 Q20 54 20 46' "
    "stroke='%231c1a15' stroke-width='5' stroke-linecap='round' fill='none'/%3E%3C/svg%3E"
)
THEME = "#faf5ea"

# Per-page metadata.
# public=True means og:* tags should be present.
PAGES = {
    "index.html":           dict(public=True,  desc=None,  # already has desc
                                  title="Stationly — Back-office operations for independent restaurants"),
    "about.html":           dict(public=True,  desc=None,
                                  title="About Stationly"),
    "platform.html":        dict(public=True,
                                  desc=None,
                                  title="Platform · Stationly"),
    "security.html":        dict(public=True,  desc=None,
                                  title="Security · Stationly"),
    "app.html":             dict(public=False,
                                  desc=None,
                                  title="Stationly — Back-office Operations"),
    "login.html":           dict(public=False,
                                  desc="Sign in to Stationly to manage your back-of-house operations.",
                                  title="Sign in · Stationly"),
    "signup.html":          dict(public=False,
                                  desc="Start your 30-day Stationly trial. No card required.",
                                  title="Sign up · Stationly"),
    "forgot-password.html": dict(public=False,
                                  desc="Reset your Stationly password.",
                                  title="Reset password · Stationly"),
    "reset-password.html":  dict(public=False,
                                  desc="Set a new password for your Stationly account.",
                                  title="Set new password · Stationly"),
    "verify.html":          dict(public=False,
                                  desc="Confirm your email to activate your Stationly account.",
                                  title="Verify email · Stationly"),
    "onboarding.html":      dict(public=False,
                                  desc="Set up your restaurant in Stationly.",
                                  title="Set up · Stationly"),
    "invite.html":          dict(public=False,
                                  desc="Accept your Stationly team invitation.",
                                  title="Join your team · Stationly"),
}


def get_indent(line: str) -> str:
    return re.match(r"\s*", line).group(0)


def has_meta(html: str, pattern: str) -> bool:
    return re.search(pattern, html) is not None


def insert_after_favicon(html: str, snippet: str) -> str:
    """Insert snippet on a new line right after the favicon link line."""
    fav_match = re.search(r"^(\s*)<link rel=\"icon\" href=\"data:image/svg\+xml.*?$",
                          html, flags=re.MULTILINE)
    if not fav_match:
        return html  # bail; no favicon line found
    indent = fav_match.group(1)
    end = fav_match.end()
    # snippet may contain multiple lines; ensure each carries indent
    indented = "\n".join(indent + line if line.strip() else line
                          for line in snippet.splitlines())
    return html[:end] + "\n" + indented + html[end:]


def normalize(path: Path, meta: dict) -> bool:
    html = path.read_text()
    original = html
    title = meta.get("title")
    desc = meta.get("desc")
    public = meta.get("public", False)

    # 1. apple-touch-icon
    if not has_meta(html, r'rel="apple-touch-icon"'):
        snippet = f'<link rel="apple-touch-icon" href="{FAVICON_SVG}" />'
        html = insert_after_favicon(html, snippet)

    # 2. theme-color
    if not has_meta(html, r'name="theme-color"'):
        snippet = f'<meta name="theme-color" content="{THEME}" />'
        html = insert_after_favicon(html, snippet)

    # 3. description
    if desc and not has_meta(html, r'<meta name="description"'):
        snippet = f'<meta name="description" content="{desc}" />'
        html = insert_after_favicon(html, snippet)

    # 4. og:* on public pages
    if public and title:
        if not has_meta(html, r'<meta property="og:title"'):
            # Need a good description for og:description
            og_desc = desc
            if not og_desc:
                m = re.search(r'<meta name="description" content="([^"]+)"', html)
                og_desc = m.group(1) if m else title
            og_block = (
                f'<meta property="og:title" content="{title}" />\n'
                f'<meta property="og:description" content="{og_desc}" />\n'
                f'<meta property="og:type" content="website" />\n'
                f'<meta name="twitter:card" content="summary_large_image" />'
            )
            html = insert_after_favicon(html, og_block)

    if html != original:
        path.write_text(html)
        return True
    return False


def main():
    changed = []
    unchanged = []
    for fname, meta in PAGES.items():
        p = ROOT / fname
        if not p.exists():
            print(f"SKIP {fname} (missing)")
            continue
        if normalize(p, meta):
            changed.append(fname)
        else:
            unchanged.append(fname)
    print("Updated:")
    for f in changed:
        print(" ", f)
    print("Unchanged:")
    for f in unchanged:
        print(" ", f)


if __name__ == "__main__":
    main()
