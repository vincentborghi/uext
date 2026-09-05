# My Extras - Chrome Extension Companion

A lightweight, standalone Chrome Extension (Manifest V3) acting as your web multi-tool companion.

---

## Features

### 1. FIP Radio Live & Metadata
* **Live Track Detection:** Automatically fetches current song title, artist, album, year, and cover art from Radio France live feeds.
* **Instant Search Links:** Direct 1-click links to YouTube, Discogs, Spotify, Wikipedia, and Bandcamp.
* **Integrated Web Stream Player:** Listen to FIP directly inside the extension popup.
* **Quick Rate & Save:** Assign 1-5 stars, custom tags (e.g. jazz, chill, groove), and notes before adding to your global library.

### 2. Universal Music Library (Multi-Source & System-Independent)
* **Multi-Origin Support:** Tracks can come from FIP, manual entry, web text selection, radio, Spotify, vinyl, etc.
* **Rating & Tagging:** Interactive 1-5 star rating system and flexible comma-separated tags (#jazz, #favorite, #live).
* **Real-time Filtering & Search:** Search across title, artist, album, tags, and notes with instant dropdown filters for Origin, Minimum Rating, and Tags.
* **Data Ownership & Portability:**
  * **Export JSON:** Full structured data backup.
  * **Export CSV:** Easy import into Excel or spreadsheet software.
  * **Import JSON:** Merge or restore saved tracks anytime.

### 3. Concert & Event Date Extractor (Google Calendar)
* **Smart Date Extraction:** Scans current web page or highlighted selection to detect French and standard date formats (e.g., 15 octobre 2026, du 12 au 15 nov, 20h30, 15/10/2026).
* **Interactive Checklist:** Review detected dates with checkboxes and customize Event Title, Venue/Location, and Calendar prefix (e.g., [Interesting]).
* **Direct Google Calendar Creation:** Generates direct event creation links in new tabs without requiring OAuth or Google API credentials setup.

### 4. BnF Remote Access (Proxy)
* **1-Click BnF Redirection:** Rewrites active tab URL to route through your Bibliotheque nationale de France (BnF) subscriber proxy (https://acces-distant.bnf.fr/login?url=...).
* **Customizable Proxy Template:** Easily edit the proxy prefix if needed.
* **Quick Catalog Bookmarks:** Fast links to Gallica, Catalogue General BnF, Cairn.info, Persee, OpenEdition, and JSTOR.

### 5. Context Menu Shortcuts (Right-Click)
* Right-click on any page or link: **Open page via BnF Remote Access**.
* Right-click on any selected text: **Save selection as Music Track** or **Extract dates to Calendar from selection**.

---

## How to Install in Chrome

1. Open Google Chrome and go to chrome://extensions/
2. Enable **Developer mode** (toggle in the top right corner).
3. Click on **Load unpacked** (Charger l\'extension non empaquetee).
4. Select the project folder: the project folder where this repository was cloned (containing manifest.json)
5. Pin the **My Extras** icon to your Chrome toolbar.
