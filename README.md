# BQOL Field

An offline web app for the iPad. A technician fills in a service report or an
installation report on site, with no connection, and the platform imports the result.

1. On the platform, make a **field pack** and email it to the technician.
2. On the iPad, open BQOL Field, go to **Pack** and load the file.
3. Under **Units**, pick a unit and fill in the report. It is saved on the iPad as you type.
   Each unit offers:
   - **New report** - a service report for the unit's next planned visit (or **Resume
     service draft** while one is waiting).
   - **Unplanned visit** - a service report for work nobody booked, such as a callout:
     no planned visit is closed, no cycle visit is chosen (so there is no task list), and
     the service type is left blank for the technician to name.
   - **Installation report** - only on units the pack marks as due one. A unit has one
     installation report, so once it exists on the iPad the button opens that one
     (**Resume installation** while it is a draft).
4. Press **Finish**. The A4 report appears: **Print / Save as PDF** uses Safari's own print,
   and **Save data file** shares or downloads the report data file.
5. Send the data file to the office, import it on the platform, and **Mark as sent**.

Everything the app needs is in this folder; it loads nothing from the internet. The
service worker keeps it working offline once it has been opened once.

This folder is the source. `css/` and `fonts/` are copied in by the build from
`src/static/`, and the build stamps the version into `sw.js`. Never edit the copies.

## The field pack (input)

`format: "bqol-field-pack"`, `version: 1`. Any other format or version is refused.

```json
{
  "format": "bqol-field-pack", "version": 1, "made_on": "2026-09-30",
  "catalogue": {
    "template_revision": "...", "version": "...",
    "scope_of_visit": {"1": "half_year", "...": "..."},
    "scopes": {"half_year": {"label": "½ yr", "tasks": [
      {"id": "...", "text": "...", "section": "review", "answer": "yes_no", "group": "",
       "answer_field": "...", "notes_field": "..."}
    ]}}
  },
  "cycle_steps": ["½ yr", "1 yr", "..."],
  "added_rows": [{"text_field": "...", "answer_field": "...", "notes_field": "..."}],
  "units": [{"bq": "900", "label": "900 (EXAMP)", "customer": "Example Water",
             "site": "Example Plant", "customer_serial": "EXAMPLE1", "placement": "",
             "open_visits": [{"id": 1, "label": "..."}],
             "prefill": {"event_id": "1", "event_type": "...", "cycle_visit": "1",
                         "performed_by": "", "assembly_order": "", "notes": ""},
             "installation_due": true,
             "installation_prefill": {"installed_on": "", "customer_tag": "EXAMPLE1"}}],
  "installation": {
    "template_revision": "...", "version": "...",
    "header_fields": ["installed_on", "performed_by", "location", "customer_tag",
                      "software_version", "profinet_version", "notes"],
    "items": [{"id": "...", "text": "...", "section": "activity", "field": "..."},
              {"id": "...", "text": "...", "section": "setting", "field": "..."}]
  }
}
```

Every form field name - task answers, task notes, the five spare rows, the installation
checklist's rows - comes from the pack. The app never builds one itself.

`installation` is optional. A pack without it (an older one) works as before and offers no
installation report. `installation_prefill` is null when `installation_due` is false. An
`activity` row is a yes/no tick; a `setting` row is free text. With no install date in the
prefill, the form starts at today.

## The report data file (output)

`format: "bqol-field-report"`, `version: 1`, saved as `report-<bq>-<event_date>.json`.

```json
{
  "format": "bqol-field-report", "version": 1, "kind": "service",
  "bq": "900", "made_at": "2026-10-02T14:03:00",
  "catalogue_version": "...", "pack_made_on": "2026-09-30", "deviation_found": false,
  "fields": {"event_id": "1", "event_date": "2026-10-02", "event_type": "...",
             "cycle_visit": "1", "performed_by": "...", "assembly_order": "", "notes": "",
             "<answer_field>": "yes", "<notes_field>": "", "...": "..."}
}
```

Every value in `fields` is a string. Every task field of the chosen cycle visit and all
five spare rows are present, blank or not. The platform validates the file again on import.

An unplanned visit is this same file with `"event_id": "unplanned"` and `"cycle_visit": ""`.
Its A4 sheet leaves out the task tables, since there are none.

### The installation report

Saved as `installation-<bq>-<installed_on>.json`, with the same character cleaning.

```json
{
  "format": "bqol-field-report", "version": 1, "kind": "installation",
  "bq": "900", "made_at": "2026-10-02T14:03:00",
  "catalogue_version": "<the pack's installation.version>", "pack_made_on": "2026-09-30",
  "fields": {"installed_on": "2026-10-02", "performed_by": "...", "location": "",
             "customer_tag": "EXAMPLE1", "software_version": "", "profinet_version": "",
             "notes": "", "<activity field>": "yes", "<setting field>": "250"}
}
```

Every header field and every checklist field is present, and every value is a string. There
is no `deviation_found`. The app checks what the platform checks: an installation date
(not in the future), who installed it, and yes/no/blank for each activity.

## Trying it locally

```powershell
python -m src.field_kit build
python -m http.server 8765 -d output/field-app
```

Then open localhost:8765 in the browser. A service worker needs localhost or HTTPS, so
opening `index.html` straight from disk works but does not install offline support.

## Storage

The pack and the reports live in the browser's local storage on that iPad
(`bqolField.pack`, `bqolField.reports`). Each report record carries a `kind` -
`service` or `installation`; a record saved before installation reports existed has none,
and is read as a service report. If storage is blocked the app still works, keeps
everything in the open tab only, and says so on every screen.
