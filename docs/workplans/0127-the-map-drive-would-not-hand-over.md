# Workplan 0127 — The map Drive would not hand over

> **In one line:** Investigates carrying Google My Maps, which Drive exports in no format, into Nextcloud Maps custom-map folders of favorites GeoJSON and GPX tracks over WebDAV, and how a map can be read at all (KML, Takeout).

## Status — 2026-09-22 (update this block at the end of every session)

**Parked for investigation, at the owner's request (2026-09-22).** Nothing is built. The owner's
words: *"Nextcloud supports Maps with https://apps.nextcloud.com/apps/maps. Perhaps we can migrate
the Google Maps object I have in my Google Drive into map items that fit in Nextcloud? Park in
workplan to investigate further."*

The target half turned out easier than expected and is written down below. The source half is the
open question, and everything else waits on it.

| Task | Status | Evidence |
|---|---|---|
| T0 The question | ✅ **Stated 2026-09-22** | Google My Maps are refused today as `source_refused` (§ What happens today): Drive exports a map in no format, so the Failures screen offers only *leave it behind*. On the owner's live Google run the maps were among the 13 `source_refused` items. |
| T1 Can a My Map be read at all? | 📋 **Open — this decides the plan** | Google publishes no My Maps API, and Drive holds the map as a file with no export. Three candidate routes, **none verified** — see § The source. Needs a live Google account; one experiment per route. |
| T2 What Nextcloud Maps can hold | 🔎 **Read 2026-09-22, from the app's own source** | A custom map is a folder in Files, written over WebDAV (§ The target). Not yet tried against a real Nextcloud. |
| T3 Which parts of a map fit | 📋 Open (needs T1's output) | Points fit Nextcloud favorites and lines fit GPX tracks. Polygons and styles have no obvious home. The table in § What fits needs one real exported map to check against. |
| T4 Where it lives in the product | 📋 Open | A converter from the source's map format to a custom-map folder on the file target, most likely inside the file pass, with what cannot fit reported rather than dropped. Shape depends on T1. |

## What happens today

- Drive lists a My Map as `application/vnd.google-apps.map`. Drive exports it in no format, and
  `packages/shared/src/google-native-coverage.ts` leaves it out of `GOOGLE_EDITOR_KINDS` on purpose:
  *"Forms, Sites, My Maps and Apps Scripts are deliberately absent: Drive exports those in no format
  at all, so no policy carries them."*
- `GoogleDriveSource.refusalFor` refuses it as `source_refused` ("has no file to copy: Drive cannot
  export a map in any format"). It lands on the Failures screen, where Accept leaves it behind.
- Nothing is lost silently: the owner is told. What is missing is any way to carry it.

## The target: Nextcloud Maps (read 2026-09-22 from `nextcloud/maps` on GitHub)

- **Maintained.** `appinfo/info.xml` is version 1.8.0 and declares Nextcloud 32–35, PHP 8.1–8.5.
- **A custom map is a folder.** README, *My Maps*: custom maps are stored in `/Maps` by default, and
  *"other folders turned into map by placing a `.index.maps` file into it"*. Content can be added
  *"via Webdav"*, the Files app or the Maps app.
- **Points** on a custom map live in that folder's `.favorites.json`: GeoJSON, read by
  `FavoritesService::getFavoritesFromJSON` as `features[].geometry.coordinates` (lng, lat) plus
  `properties` (`Title`, `Published`, …).
- **Lines** are tracks: `*.gpx` files in the folder.
- Contacts on a custom map are vCards, and photos sit in the folder.
- **Importers** (`FavoritesService::importFavorites`) take `.kml`, `.kmz`, `.gpx` and
  `.json`/`.geojson` (Google Takeout's GeoJSON). The KML importer turns a `Placemark`'s name,
  coordinates and description into a favorite, and **skips `LineString` placemarks**.

So the target needs no Maps API: a migrated map would be a folder of plain files on the WebDAV
target this product already writes. Without the Maps app installed they are still ordinary,
readable files.

## The source (T1): three candidate routes, none verified

1. **My Maps' own KML download**, by map id. To find out: whether it accepts an OAuth bearer token
   rather than only a browser session, which scope that takes, and whether a Drive file id is the
   map's id.
2. **Google Takeout**, which exports My Maps (believed to be KML/KMZ per map; to confirm). The
   product already reads Takeout archives (workplans 0112 and 0116), so this route may reuse that
   door rather than open a new one.
3. **By hand**: the owner exports KML/KMZ from My Maps into Drive. The migration then carries an
   ordinary file, and this plan's only job is converting it (T3) instead of copying it as-is.

Each route is one experiment against a live account. Route 1 is the only one that keeps the map
in the ordinary pass. Route 3 always works but asks the person to do something.

## What fits (T3, to check against a real map)

| In a My Map | In Nextcloud Maps | Question |
|---|---|---|
| Point with name, description | Favorite: name, comment, lat/lng, category | Is the icon or colour kept anywhere? |
| Layer | A favorite category, or its own custom-map folder | Decision D1 |
| Line or route | GPX track | Is a driving route just its line? |
| Polygon | Nothing found | Reported as left behind (D2) |
| Photo on a point | Photos in the folder? | Unclear |
| Map title, description | Folder name | Where does the description go? |

## Decisions for the owner (not yet asked; they need T1 first)

- **D1** Where a migrated map goes: its own custom-map folder (`/Maps/<title>/`), or merged into the
  person's default favorites.
- **D2** What the report says about what cannot fit (polygons, styles): per map, in the same shape
  as the refusal categories.
- **D3** What happens when the Maps app is not installed on the target: write the folder anyway
  (they are plain files), or say so first.

## Why parked

- T1 decides whether any of this is possible, and it needs a live Google account.
- The volume is small: a person has a handful of maps, not thousands. Worth doing well rather than
  soon.

**To resume:** T1 first, one experiment per route. Then fill T3's table against one real exported
map, then ask D1–D3.
