#!/usr/bin/env python3
"""
Validation script for apps/web static files.
Ensures valid HTML5 structure, required SEO/a11y tags, correct internal links,
asset existence, and required legal/ODbL notices.
"""

import os
import shutil
import subprocess
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
        self.meta_names: set[str] = set()

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
            name = attr_dict.get("name", "").lower()
            if name == "viewport":
                self.has_meta_viewport = True
            if name:
                self.meta_names.add(name)

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

        if html_file.name == "course.html":
            if "fairway-api-url" not in validator.meta_names:
                raise ValueError(f"{html_file.name}: Missing <meta name=\"fairway-api-url\" ...> override element")
            if "fairway-app-store-url" not in validator.meta_names:
                raise ValueError(f"{html_file.name}: Missing <meta name=\"fairway-app-store-url\" ...> override element")
            if 'content="https://fairway-api-h93s.onrender.com"' not in content:
                raise ValueError(f"{html_file.name}: fairway-api-url meta tag must configure the provisioned API endpoint")

        if html_file.name in ("terms.html", "privacy.html"):
            if "TEMPLATE NOTICE" not in content:
                raise ValueError(f"{html_file.name}: Missing internal legal template notice")

        if html_file.name == "privacy.html":
            if "Expo (650 Industries)" not in content:
                raise ValueError(f"{html_file.name}: Missing disclosure for Expo push notification infrastructure")
            if "Sentry" in content:
                raise ValueError(f"{html_file.name}: Unintegrated Sentry disclosure must be removed")
            if "best-effort" not in content or "DeviceNotRegistered" not in content:
                raise ValueError(f"{html_file.name}: Push token retention must describe best-effort unregistration and pruning")
            if "deletion_pending" not in content or "remediation" not in content:
                raise ValueError(f"{html_file.name}: Missing disclosure for deletion_pending status and administrative remediation")

        if "id6742358055" in content:
            raise ValueError(f"{html_file.name}: Unprovisioned App Store identifier id6742358055 must not be hard-coded")

        if html_file.name == "index.html":
            if "onclick=" in content and "alert(" in content:
                raise ValueError(f"{html_file.name}: Placeholder alert onclick on download button must be replaced with real store link")
            if "fairway-app-store-url" not in validator.meta_names:
                raise ValueError(f"{html_file.name}: Missing <meta name=\"fairway-app-store-url\" ...> element")

        print(f"  ✓ {html_file.name} is valid (title: '{validator.title_text}')")

    # Verify course.js exists and validate its contract
    course_js = web_dir / "course.js"
    validate_course_js(course_js)

    # Verify robots.txt exists
    robots = web_dir / "robots.txt"
    if not robots.exists():
        raise FileNotFoundError("Missing apps/web/robots.txt")
    print("  ✓ robots.txt exists")

    print(f"\nAll {len(html_files)} HTML files and assets validated successfully!")


def validate_course_js(course_js: Path) -> None:
    if not course_js.exists():
        raise FileNotFoundError(f"Missing {course_js}")

    content = course_js.read_text(encoding="utf-8")

    # Static checks addressing Codex findings
    if "course.hole_count != null ? escapeHtml(String(course.hole_count)) : '18'" in content:
        raise ValueError("course.js must not invent hole_count=18 when unknown; must use '—'")

    if "course.hole_count != null ? escapeHtml(String(course.hole_count)) : '—'" not in content:
        raise ValueError("course.js must format unknown hole_count as '—'")

    if "/courses?\\/(" in content:
        raise ValueError("course.js contains unsupported path-based routing regex that breaks relative assets")

    if "renderHeroAttribution" not in content or "license_url" not in content or "source_url" not in content:
        raise ValueError("course.js must implement renderHeroAttribution preserving source_url and license_url")

    if "Est. Green Fee" not in content:
        raise ValueError("course.js must label green fee as 'Est. Green Fee'")

    if "course.status !== 'active'" not in content:
        raise ValueError("course.js must reject courses with status !== 'active'")

    if "getAppStoreUrl" not in content:
        raise ValueError("course.js must implement getAppStoreUrl")

    if "https://fairway-api-h93s.onrender.com" not in content:
        raise ValueError("course.js must configure provisioned fairway-api-h93s.onrender.com endpoint")

    if "alert(" in content:
        raise ValueError("course.js must route unsuccessful opens to getAppStoreUrl without alert dialogs")

    if "id6742358055" in content:
        raise ValueError("course.js must not hard-code unprovisioned store identifier id6742358055")

    # If Node.js is installed in the environment, run syntax and behavior tests
    node_bin = shutil.which("node")
    if node_bin:
        # Syntax check
        res = subprocess.run([node_bin, "--check", str(course_js)], capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"node --check failed for {course_js.name}: {res.stderr}")

        # Behavioral test using node
        test_script = f"""
(async () => {{
  const fs = require('fs');
  const vm = require('vm');
  const js = fs.readFileSync({repr(str(course_js))}, 'utf8');

  // Test 1: Malformed and missing IDs are rejected
  for (const search of ['', '?id=', '?id=abc', '?id=-5', '?id=0']) {{
    let rendered = '';
    const window = {{ location: {{ hostname: 'localhost', search, pathname: '/' }} }};
    const document = {{
      querySelector: () => null,
      getElementById: () => ({{ set innerHTML(v) {{ rendered = v; }}, get innerHTML() {{ return rendered; }}, addEventListener: () => {{}} }}),
      readyState: 'complete',
      title: ''
    }};
    const sandbox = {{
      window, document, console, URLSearchParams, Date, setTimeout, parseInt, String,
      fetch: async () => {{ throw new Error('Fetch must not be called on invalid ID'); }}
    }};
    vm.createContext(sandbox);
    vm.runInContext(js, sandbox);
    await new Promise(r => setTimeout(r, 50));
    if (!rendered.includes('No valid course ID was provided')) {{
      throw new Error('Expected invalid ID error state for ' + search);
    }}
  }}

  // Test 2: Hero attribution renders source and license links, and hole_count=null displays em dash
  let rendered = '';
  const window = {{ location: {{ hostname: 'localhost', search: '?id=42', pathname: '/' }} }};
  const document = {{
    querySelector: () => null,
    getElementById: () => ({{ set innerHTML(v) {{ rendered = v; }}, get innerHTML() {{ return rendered; }}, addEventListener: () => {{}} }}),
    readyState: 'complete',
    title: ''
  }};
  const sandbox = {{
    window, document, console, URLSearchParams, Date, setTimeout, parseInt, String,
    fetch: async () => ({{
      ok: true,
      json: async () => ({{
        id: 42,
        name: 'Spyglass Hill',
        hole_count: null,
        hero_image: {{
          type: 'WIKIMEDIA',
          url: 'https://example.com/spyglass.jpg',
          attribution: 'Jane Golfer',
          source_url: 'https://commons.wikimedia.org/wiki/File:Spyglass.jpg',
          license: 'CC BY-SA 4.0',
          license_url: 'https://creativecommons.org/licenses/by-sa/4.0/'
        }}
      }})
    }})
  }};
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  await new Promise(r => setTimeout(r, 50));

  if (!rendered.includes('https://commons.wikimedia.org/wiki/File:Spyglass.jpg')) {{
    throw new Error('Attribution missing source link');
  }}
  if (!rendered.includes('https://creativecommons.org/licenses/by-sa/4.0/')) {{
    throw new Error('Attribution missing license link');
  }}
  if (!rendered.includes('CC BY-SA 4.0')) {{
    throw new Error('Attribution missing license name');
  }}
  if (!rendered.includes('Holes</span>\\n                <span class="stat-value">—</span>')) {{
    throw new Error('Unknown hole count not displayed as em dash');
  }}
  if (!rendered.includes('Est. Green Fee')) {{
    throw new Error('Est. Green Fee label missing from rendered course');
  }}
  if (!rendered.includes('Get the App')) {{
    throw new Error('Missing Get the App button in rendered course');
  }}

  // Test 3: Retired courses are rejected
  rendered = '';
  const sandboxRetired = {{
    window: {{ location: {{ hostname: 'localhost', search: '?id=99', pathname: '/' }} }},
    document: {{
      querySelector: () => null,
      getElementById: () => ({{ set innerHTML(v) {{ rendered = v; }}, get innerHTML() {{ return rendered; }}, addEventListener: () => {{}} }}),
      readyState: 'complete',
      title: ''
    }},
    console, URLSearchParams, Date, setTimeout, parseInt, String,
    fetch: async () => ({{
      ok: true,
      json: async () => ({{ id: 99, name: 'Retired Links', status: 'retired' }})
    }})
  }};
  vm.createContext(sandboxRetired);
  vm.runInContext(js, sandboxRetired);
  await new Promise(r => setTimeout(r, 50));
  if (!rendered.includes('is no longer active in the catalog')) {{
    throw new Error('Retired course was not rejected');
  }}
}})();
"""
        test_res = subprocess.run([node_bin, "-e", test_script], capture_output=True, text=True)
        if test_res.returncode != 0:
            raise RuntimeError(f"Node execution test failed: {test_res.stderr}")
        print("  ✓ course.js validated (syntax, ID rejection, attribution links, hole count fallback)")
    else:
        print("  ✓ course.js validated (static checks; node not found in PATH)")


if __name__ == "__main__":
    current_dir = Path(__file__).resolve().parent.parent
    try:
        validate_web_dir(current_dir)
    except Exception as exc:
        print(f"Validation failed: {exc}", file=sys.stderr)
        sys.exit(1)
