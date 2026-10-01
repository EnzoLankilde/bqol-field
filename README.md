# BQOL Field

An offline web app for the iPad. A technician fills in a service report, an
installation report or a parts sheet on site, with no connection, and the platform imports the result.

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
   Above the list, **Parts used** starts a parts sheet for a trip to one customer's sites (see below).
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

### Parts used

A pack from a platform that has the parts list also carries `parts`, `billing`,
`parts_sheet`, `sites` and `technicians`, and each unit gains `site_id` and
`parts_prefill`. A pack without them (an older one) offers no **Parts used**.

```json
{
  "parts": {"version": "...", "items": [{"number": "90001", "description": "...", "kind": "visit"}],
            "storage_locations": ["..."], "problems": []},
  "billing": {"version": "...", "confirmed": false, "ok": true,
              "visit_types": {"serviceaftale": "...", "planlagt": "...", "tilkaldt": "..."},
              "starts_as": {"none": "planlagt", "prepaid": "serviceaftale", "sla": "serviceaftale"},
              "cycle_visit_types": ["serviceaftale", "planlagt"],
              "table": {"<agreement>": {"<visit type>": {"<line kind>": {"invoice": true, "reason": "..."}}}}},
  "parts_sheet": {"header": {"site_ids": "...", "trip_date": "...", "visit_type": "...",
                             "technician_id": "...", "units": "...", "notes": "..."},
                  "lines": [{"number": "...", "quantity": "...", "units": "...", "invoice": "...",
                             "warranty": "...", "storage": "..."}],
                  "trip_kinds": ["visit", "hours"], "unit_kinds": ["kit", "chemistry", "part"]},
  "sites": [{"id": 1, "customer_id": 1, "customer": "...", "label": "...",
             "agreement": {"kind": "none", "expires": ""}}],
  "technicians": [{"id": 1, "name": "...", "initials": "..."}]
}
```

Per unit: `"parts_prefill": {"visit_item": "90001", "kit_items": [{"number": "90021", "quantity": "1"}]}`,
worked out on the platform from the unit's next cycle visit.

Each site's `agreement` is its customer's - every site of one customer carries the same one -
and `customer_id` says whose it is. **One sheet is one customer's**: the start step lists the sites
as tick boxes grouped by customer, and ticking a site of another customer clears the ones ticked
so far (the simpler of the two behaviours; the other was greying them out). The units offered
are those at any ticked site, under a heading per site. The visit type a sheet starts on and the
agreement warning come from the customer, through its first ticked site. A pack from before
`customer_id` groups by the customer's name instead.

The app never works out who pays. Each line's invoice yes/no starts from
`billing.table[agreement][visit_type][line kind]`; the only date logic is that an agreement
whose `expires` is before the trip date counts as `none`, with a warning. The technician can
overrule a line; the platform decides on import whether the posted answer differs from the rule.
**Garanti** is a tick under each line's Invoice: ticked, the line posts `warranty` "yes" and
invoice "no", the select is disabled, and the line is never counted as overruled; unticked, it
goes back to the rule, or to the technician's own yes/no if he had overruled it first. A pack
without a `warranty` name in its line rows (an older one) shows no Garanti tick.
A trip line (`trip_kinds`) names no units and its quantity is for the whole trip; a unit line
names the units it went into, from the trip's ticked units only, and its quantity is per unit.
On a one-unit trip every unit line is on that unit.

Saved as `parts-customer<customer id>-<trip date>.json`:

```json
{
  "format": "bqol-field-report", "version": 1, "kind": "parts", "customer_id": "1",
  "made_at": "2026-10-02T14:03:00", "parts_version": "...", "billing_version": "...",
  "pack_made_on": "2026-09-30",
  "fields": {"site_ids": "1 4", "trip_date": "2026-10-02", "visit_type": "serviceaftale",
             "technician_id": "1", "units": "900 901", "notes": "",
             "<lines[0].number>": "90001", "<lines[0].quantity>": "1", "<lines[0].units>": "",
             "<lines[0].invoice>": "no", "<lines[0].warranty>": "", "<lines[0].storage>": "",
             "...": "..."}
}
```

Every header field and every row of `parts_sheet.lines` is present, blank or not, and every
value is a string. A row with no item and no quantity is empty. Units are BQ serials separated
by a space, and so are the site ids. The envelope's `customer_id` names the file; the platform
works the customer out from the sites again and refuses sites of two customers. Its A4 sheet is
the logistics sheet: Customer, Sites, and every line with its quantity per unit, the units, the
total, invoice Yes/No (marked when overruled, "No – Garanti" on a Garanti line) and where it was
taken from.

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
`service`, `installation` or `parts`; a record saved before installation reports existed has none,
and is read as a service report. If storage is blocked the app still works, keeps
everything in the open tab only, and says so on every screen.
