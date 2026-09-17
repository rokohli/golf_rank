#!/usr/bin/env python3
"""
Validation script for apps/web static files.
Ensures valid HTML5 structure, required SEO/a11y tags, correct internal links,
asset existence, and required legal/ODbL notices.
"""

import os
import sys
from html.parser import HTMLParser
from pathlib import Path


class HTMLValidator(HTMLParser):
    def __init__(self, filepath: Path):
        super().__init__()
        self.filepath = filepath
        self.has_doctype = False
        self.has_html = False
        self.has_meta_charset = False
        self.has_meta_viewport = False
        self.has_title = False
        self.title_text = ""
        self.in_title = False
        self.local_links: list[str] = []
        self.local_assets: list[str] = []

    def handle_decl(self, decl: str) -> None:
        if decl.lower().strip() == "doctype html":
            self.has_doctype = True

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = dict(attrs)
        tag = tag.lower()

        if tag == "html":
            self.has_html = True
            if "lang" not in attr_dict:
                raise ValueError(f"{self.filepath}: <html> tag missing 'lang' attribute")

        elif tag == "meta":
            if "charset" in attr_dict:
                self.has_meta_charset = True
            if attr_dict.get("name", "").lower() == "viewport":
                self.has_meta_viewport = True

        elif tag == "title":
            self.has_title = True
            self.in_title = True

        elif tag == "link" and attr_dict.get("rel") == "stylesheet":
            href = attr_dict.get("href")
            if href and not href.startswith(("http://", "https://", "//")):
                self.local_assets.append(href)

        elif tag == "script" and "src" in attr_dict:
            src = attr_dict.get("src")
            if src and not src.startswith(("http://", "https://", "//")):
                self.local_assets.append(src)

        elif tag == "a" and "href" in attr_dict:
            href = attr_dict.get("href", "")
            if href and not href.startswith(("http://", "https://", "mailto:", "tel:", "#", "golfrank:")):
                # Strip query and fragment
                clean_href = href.split("?")[0].split("#")[0]
                if clean_href:
                    self.local_links.append(clean_href)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_text += data.strip()


def validate_web_dir(web_dir: Path) -> None:
    html_files = list(web_dir.glob("*.html"))
    if not html_files:
        raise RuntimeError(f"No HTML files found in {web_dir}")

    print(f"Validating {len(html_files)} HTML files in {web_dir}...")

    for html_file in html_files:
        content = html_file.read_text(encoding="utf-8")
        validator = HTMLValidator(html_file)
        validator.feed(content)

        if not validator.has_doctype:
            raise ValueError(f"{html_file.name}: Missing <!DOCTYPE html>")
        if not validator.has_html:
            raise ValueError(f"{html_file.name}: Missing <html> tag")
        if not validator.has_meta_charset:
            raise ValueError(f"{html_file.name}: Missing <meta charset=\"...\">")
        if not validator.has_meta_viewport:
            raise ValueError(f"{html_file.name}: Missing <meta name=\"viewport\" ...>")
        if not validator.has_title or not validator.title_text:
            raise ValueError(f"{html_file.name}: Missing or empty <title> tag")

        # Check local assets exist
        for asset in validator.local_assets:
            target = (html_file.parent / asset).resolve()
            if not target.exists():
                raise FileNotFoundError(f"{html_file.name}: Referenced asset not found: {asset}")

        # Check local links exist
        for link in validator.local_links:
            target = (html_file.parent / link).resolve()
            if not target.exists():
                raise FileNotFoundError(f"{html_file.name}: Referenced page not found: {link}")

        # Special checks for catalog attribution & legal notice
        if html_file.name in ("index.html", "course.html"):
            if "OpenGolfAPI, ODbL 1.0" not in content:
                raise ValueError(f"{html_file.name}: Missing required ODbL attribution")

        if html_file.name in ("terms.html", "privacy.html"):
            if "TEMPLATE NOTICE" not in content:
                raise ValueError(f"{html_file.name}: Missing internal legal template notice")

        print(f"  ✓ {html_file.name} is valid (title: '{validator.title_text}')")

    # Verify robots.txt exists
    robots = web_dir / "robots.txt"
    if not robots.exists():
        raise FileNotFoundError("Missing apps/web/robots.txt")
    print("  ✓ robots.txt exists")

    print(f"\nAll {len(html_files)} HTML files and assets validated successfully!")


if __name__ == "__main__":
    current_dir = Path(__file__).resolve().parent.parent
    try:
        validate_web_dir(current_dir)
    except Exception as exc:
        print(f"Validation failed: {exc}", file=sys.stderr)
        sys.exit(1)
