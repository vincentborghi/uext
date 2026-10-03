# My Extras - Chrome Extension Companion

A lightweight, standalone Chrome Extension (Manifest V3) acting as your web multi-tool companion.

---

## Features

### 1. Concert & Event Date Extractor (Scheduler Assistant / Google Calendar)
* **AI-Powered & Regex Smart Scanning:** Scans the active web page, flyer/poster images, or highlighted text using Gemini AI or pattern recognition to detect French and international date formats, intervals, and exact time slots.
* **Intelligent Event Categorization:** Automatically recognizes event nature (Concert, Theatre, Dance, Workshop/Stage, Exhibition, Festival) and formats clean, standardized event titles and venues.
* **Interactive Scheduling Checklist:** Review detected dates with individual checkboxes, adjust title, location, or notes, and pick your target Google Calendar.
* **1-Click Google Calendar Scheduling:** Generates direct event creation links in new tabs without requiring OAuth or complex Google API credential setup.

### 2. FIP Radio Live & Metadata
* **Live Track Detection:** Automatically fetches current song title, artist, album, year, and cover art from Radio France live feeds.
* **Instant Search Links:** Direct 1-click links to YouTube, Discogs, Spotify, Wikipedia, and Bandcamp.
* **Integrated Web Stream Player:** Listen to FIP directly inside the extension popup.
* **Quick Rate & Save:** Assign 1-5 stars, custom tags (e.g. jazz, chill, groove), and notes before adding to your global library.

### 3. Universal Music Library (Multi-Source & System-Independent)
* **Multi-Origin Support:** Tracks can come from FIP, manual entry, web text selection, radio, Spotify, vinyl, etc.
* **Rating & Tagging:** Interactive 1-5 star rating system and flexible comma-separated tags (#jazz, #favorite, #live).
* **Real-time Filtering & Search:** Search across title, artist, album, tags, and notes with instant dropdown filters for Origin, Minimum Rating, and Tags.
* **Data Ownership & Portability:**
  * **Export JSON:** Full structured data backup.
  * **Export CSV:** Easy import into Excel or spreadsheet software.
  * **Import JSON:** Merge or restore saved tracks anytime.

### 4. BnF Remote Access (Proxy)
* **1-Click BnF Redirection:** Rewrites active tab URL to route through your Bibliotheque nationale de France (BnF) subscriber proxy (https://bnf.idm.oclc.org/login?url=...).
* **Customizable Proxy Template:** Easily edit the proxy prefix if needed.
* **Quick Catalog Bookmarks:** Fast links to Gallica, Catalogue General BnF, Cairn.info, Persee, OpenEdition, and JSTOR.

### 5. Context Menu Shortcuts (Right-Click)
* Right-click on any page or link: **Open page via BnF Remote Access**.
* Right-click on any selected text: **Save selection as Music Track** or **Extract dates to Calendar from selection**.

---

## How to Install in Chrome

### Step 1: Download & Extract
1. On this GitHub repository page, click the green **Code** button and choose **Download ZIP** (or clone via `git clone https://github.com/vincentborghi/uext.git`).
2. Locate the downloaded ZIP file (e.g. `uext-main.zip`), right-click it, and choose **Extract All...** (Extraire tout...).

### Step 2: Load into Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the top right corner.
3. Click the **Load unpacked** button (Charger l\'extension non empaquetee) in the top left.
4. Select the extracted folder containing `manifest.json` (typically `uext-main`).
5. Pin the **My Extras** icon to your Chrome toolbar for convenient 1-click access.
