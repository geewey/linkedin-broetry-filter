# 🚫 LinkedIn Broetry Filter

A Chrome extension that detects and hides LinkedIn posts written in the "broetry" style — those posts that break simple ideas into dramatic one-liner fragments for manufactured engagement.

## What it filters

Posts like this:

> I got rejected from 100 jobs.  
> Then something changed.  
> One email.  
> One conversation.  
> Everything.

## Features

- **Toggle on/off** — instantly show/hide filtered posts
- **Sensitivity control** — Relaxed, Medium, or Strict detection
- **Show anyway** — reveal any individual hidden post with one click
- **Session stats** — see how many posts were scanned and filtered
- **Non-destructive** — posts are hidden, never deleted

## How detection works

The extension analyzes the structure of each post's text, looking for:

- High ratio of very short lines (1-5 words)
- Single-word "dramatic" lines
- Low average words-per-line relative to total line count
- Formulaic "story arc" patterns (statement → buildup → one-word punchline)

It uses a scoring system across multiple heuristics, so it won't flag every short post — only ones that stack up enough broetry signals.

## Installation

1. Download and unzip this extension
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the unzipped `linkedin-broetry-filter` folder
6. Navigate to LinkedIn — the extension is now active

## Usage

- Click the extension icon in your toolbar to open the popup
- Use the toggle to enable/disable filtering
- Adjust sensitivity:
  - **Relaxed** — only catches the most egregious broetry
  - **Medium** — balanced (recommended)
  - **Strict** — aggressively filters short-line posts
- Click "Show anyway" on any placeholder to reveal a hidden post
