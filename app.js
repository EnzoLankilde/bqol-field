/* BQOL Field - the offline service, installation and parts reports for the iPad.
   One file, no framework, no build step. It reads a field pack made on the
   platform and writes a report data file the platform imports. Every form
   field name comes from the pack; none is ever put together here, so the
   platform stays the one place that decides what a field is called. */
"use strict";

(function () {
    const PACK_KEY = "bqolField.pack";
    const REPORTS_KEY = "bqolField.reports";
    const PACK_FORMAT = "bqol-field-pack";
    const REPORT_FORMAT = "bqol-field-report";
    const FORMAT_VERSION = 1;
    const UNPLANNED = "unplanned";
    const REVIEW_SECTION = "review";
    const TEXT_ANSWER = "text";
    const KIND_SERVICE = "service";
    const KIND_INSTALLATION = "installation";
    const KIND_PARTS = "parts";
    const KIND_TITLE = { service: "Service report", installation: "Installation report", parts: "Parts used" };
    const ACTIVITY_SECTION = "activity";
    const DASH = "—";
    const BASE_KEYS = ["event_id", "event_date", "event_type", "cycle_visit",
        "performed_by", "assembly_order", "notes"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    /* How the installation header reads: the platform's labels, hints and
       required marks, word for word. The names themselves come from the pack's
       `header_fields`; one the app does not know still gets a plain input. */
    const INSTALL_HEADER = {
        installed_on: { label: "Installation date", required: true,
            hint: "YYYY-MM-DD. Pre-filled from the unit's install date where it has one." },
        performed_by: { label: "Installed by", required: true,
            hint: "The paper form's initials. A report with nobody named is an incomplete record." },
        location: { label: "Installation location", hint: "Where in the customer's plant it sits, in their words." },
        customer_tag: { label: "Customer tag number", hint: "Pre-filled from the unit's customer serial. Their number for the machine." },
        software_version: { label: "BQOL software version", hint: "The firmware on the day it was commissioned — not the hardware generation." },
        profinet_version: { label: "Profinet module, software version", hint: "Where a Profinet module is fitted." },
        notes: { label: "Notes", hint: "The paper form's Notes lines - what is still to be done, or anything unusual on the day." },
    };
    /* The platform's column limits (src/installation.py), so a long entry is
       caught here rather than on import. */
    const INSTALL_MAX = { performed_by: 200, location: 200, customer_tag: 100,
        software_version: 50, profinet_version: 50, notes: 2000, value: 200 };
    /* The parts list's five line kinds (parts_catalogue.LINE_KINDS), for the
       screen's words. Which kinds are per trip comes from the pack. */
    const LINE_VISIT = "visit";
    const LINE_KIT = "kit";
    const KIND_LABEL = { visit: "Visit", kit: "Kit", chemistry: "Chemistry",
        hours: "Technician hours", part: "Spare part" };
    const ADD_BUTTONS = [["part", "Add part"], ["hours", "Add hours"], ["chemistry", "Add chemistry"],
        ["kit", "Add kit"], ["visit", "Add another visit"]];
    const AGREEMENT_NONE = "none";
    const AGREEMENT_LABEL = { none: "No agreement", prepaid: "Prepaid agreement",
        sla: "SLA - invoiced after each visit" };
    // The platform's quantity rule (parts_sheet.QUANTITY_PATTERN), checked again on import.
    const QUANTITY = /^\d{1,6}([.,]\d{1,2})?$/;
    const PARTS_NOTES_MAX = 2000;
    const STATUS = {
        draft: { text: "Draft", badge: "badge-plan" },
        finished: { text: "Finished - not sent", badge: "badge-warning" },
        sent: { text: "Sent", badge: "badge-neutral" },
    };

    const state = {
        pack: null,
        reports: [],
        errors: {},
        flash: "",
        confirmDelete: "",
        unitQuery: "",
        currentId: "",
        storageFailed: false,
    };

    /* ---------------------------------------------------------------- storage
       localStorage can throw (private browsing, quota, blocked site data). The
       memory copy is always written first, so the app keeps working in the
       tab and says plainly that nothing is being kept. */
    const memory = {};

    function readStore(key) {
        if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function writeStore(key, value) {
        memory[key] = value;
        try {
            window.localStorage.setItem(key, value);
        } catch (e) {
            state.storageFailed = true;
        }
    }

    function parseJson(raw, fallback) {
        if (raw === null || raw === undefined) return fallback;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function loadState() {
        const pack = parseJson(readStore(PACK_KEY), null);
        state.pack = pack && !checkPack(pack) ? pack : null;
        const reports = parseJson(readStore(REPORTS_KEY), []);
        state.reports = Array.isArray(reports) ? reports.filter(isRecord) : [];
        // Phase 1 saved service reports with no kind; they are service reports.
        state.reports.forEach((record) => { record.kind = kindOf(record); });
    }

    function isRecord(record) {
        return Boolean(record) && typeof record === "object" && !Array.isArray(record);
    }

    function kindOf(record) {
        if (record && record.kind === KIND_INSTALLATION) return KIND_INSTALLATION;
        if (record && record.kind === KIND_PARTS) return KIND_PARTS;
        return KIND_SERVICE;
    }

    function savePack(pack) {
        state.pack = pack;
        writeStore(PACK_KEY, JSON.stringify(pack));
    }

    function saveReports() {
        writeStore(REPORTS_KEY, JSON.stringify(state.reports));
    }

    /* ---------------------------------------------------------------- helpers */
    function esc(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function pad(number) {
        return String(number).padStart(2, "0");
    }

    function todayIso() {
        const now = new Date();
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    function nowIso() {
        const now = new Date();
        return `${todayIso()}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    function isIsoDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const [year, month, day] = value.split("-").map(Number);
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    }

    /** "3 Oct 2026", the platform's one display format. */
    function niceDate(iso) {
        if (!iso || !isIsoDate(iso)) return iso || DASH;
        const [year, month, day] = iso.split("-").map(Number);
        return `${day} ${MONTHS[month - 1]} ${year}`;
    }

    function niceStamp(stamp) {
        if (!stamp) return DASH;
        const [day, time] = String(stamp).split("T");
        return `${niceDate(day)} ${(time || "").slice(0, 5)}`.trim();
    }

    function orDash(value) {
        return value ? value : DASH;
    }

    function groupHeading(group) {
        return String(group).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function answerLabel(value) {
        if (!value) return DASH;
        if (value === "yes") return "Yes";
        if (value === "no") return "No";
        return value;
    }

    function newId() {
        return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    }

    function asText(value) {
        return value === null || value === undefined ? "" : String(value);
    }

    /* ---------------------------------------------------------------- the pack */
    function checkPack(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return "This file is not a field pack. Make one on the platform and load that.";
        }
        if (data.format !== PACK_FORMAT) {
            return "This file is not a BQOL field pack. Make one on the platform and load that.";
        }
        if (data.version !== FORMAT_VERSION) {
            return `This field pack is version ${String(data.version)}, and this app reads version ${FORMAT_VERSION} only. Make a new pack on the platform, or update the app.`;
        }
        const catalogue = data.catalogue;
        if (!catalogue || typeof catalogue !== "object" || !catalogue.scopes || !catalogue.scope_of_visit
            || !Array.isArray(data.units) || !Array.isArray(data.added_rows) || !Array.isArray(data.cycle_steps)) {
            return "This field pack is incomplete - it has no units, catalogue or spare rows. Make a new one on the platform.";
        }
        return "";
    }

    function findUnit(bq) {
        if (!state.pack) return null;
        return state.pack.units.find((unit) => String(unit.bq) === String(bq)) || null;
    }

    /** The task list for a cycle visit: none outside the cycle, and `missing`
        when the pack names a visit its catalogue cannot cost. */
    function taskListFor(cycleVisit) {
        if (!cycleVisit || !state.pack) return { tasks: [], missing: false };
        const catalogue = state.pack.catalogue;
        const scopeKey = catalogue.scope_of_visit[cycleVisit];
        const scope = scopeKey ? catalogue.scopes[scopeKey] : null;
        if (!scope || !Array.isArray(scope.tasks)) return { tasks: [], missing: true };
        return { tasks: scope.tasks, missing: false };
    }

    function taskFieldNames(tasks) {
        const names = [];
        tasks.forEach((task) => {
            names.push(task.answer_field);
            if (task.notes_field) names.push(task.notes_field);
        });
        return names;
    }

    function spareFieldNames() {
        const names = [];
        state.pack.added_rows.forEach((row) => {
            [row.text_field, row.answer_field, row.notes_field].forEach((name) => {
                if (name) names.push(name);
            });
        });
        return names;
    }

    /** The pack's installation checklist, or null. An older pack has none, and
        then no installation report is offered - never an error. */
    function installationCatalogue() {
        const entry = state.pack ? state.pack.installation : null;
        if (!entry || typeof entry !== "object" || !Array.isArray(entry.items)
            || !Array.isArray(entry.header_fields)) return null;
        return entry;
    }

    function installationItems(section) {
        const catalogue = installationCatalogue();
        if (!catalogue) return [];
        const isActivity = (item) => item.section === ACTIVITY_SECTION;
        return catalogue.items.filter((item) => (section === ACTIVITY_SECTION ? isActivity(item) : !isActivity(item)));
    }

    function installationFieldNames() {
        const catalogue = installationCatalogue();
        if (!catalogue) return [];
        return catalogue.header_fields.map(String).concat(catalogue.items.map((item) => item.field));
    }

    function installationOffered(unit) {
        return Boolean(installationCatalogue()) && unit.installation_due === true;
    }

    /* ---------------------------------------------------------------- records */
    function findRecord(id) {
        return state.reports.find((record) => record.id === id) || null;
    }

    function latestRecordFor(bq) {
        const own = state.reports.filter((record) => record.bq === bq);
        own.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        return own[0] || null;
    }

    function draftFor(bq, kind) {
        return state.reports.find((record) => record.bq === bq && record.status === "draft" && kindOf(record) === kind) || null;
    }

    /** A unit is installed once, so its installation report on this iPad is
        the one to go back to, whatever its status. */
    function installationRecordFor(bq) {
        const own = state.reports.filter((record) => record.bq === bq && kindOf(record) === KIND_INSTALLATION);
        const draft = own.find((record) => record.status === "draft");
        if (draft) return draft;
        own.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        return own[0] || null;
    }

    function prefillValues(unit) {
        const prefill = unit.prefill || {};
        const openVisits = Array.isArray(unit.open_visits) ? unit.open_visits : [];
        const values = {};
        BASE_KEYS.forEach((key) => { values[key] = asText(prefill[key]); });
        if (!openVisits.length) values.event_id = UNPLANNED;
        else if (!values.event_id) values.event_id = String(openVisits[0].id);
        values.event_date = todayIso();
        return values;
    }

    /** An unplanned visit is a service report outside the cycle: no visit to
        close, no task list, and the technician names the work himself. */
    function unplannedValues(unit) {
        const values = prefillValues(unit);
        values.event_id = UNPLANNED;
        values.cycle_visit = "";
        values.event_type = "";
        return values;
    }

    /** Every header and checklist field present, with what the platform knows
        filled in. With no install date on record, today - it is being
        installed now. */
    function installationValues(unit) {
        const prefill = unit.installation_prefill || {};
        const values = {};
        installationFieldNames().forEach((name) => { values[name] = ""; });
        values.installed_on = asText(prefill.installed_on) || todayIso();
        values.customer_tag = asText(prefill.customer_tag);
        return values;
    }

    function startingValues(unit, kind, unplanned) {
        if (kind === KIND_INSTALLATION) return installationValues(unit);
        return unplanned ? unplannedValues(unit) : prefillValues(unit);
    }

    function newRecord(unit, kind, unplanned) {
        const record = {
            id: newId(),
            kind: kind,
            bq: String(unit.bq),
            label: unit.label || String(unit.bq),
            status: "draft",
            updated_at: nowIso(),
            values: startingValues(unit, kind, unplanned),
            deviation_found: false,
            sheet: null,
            report: null,
        };
        record.report = buildReport(record);
        state.reports.push(record);
        saveReports();
        return record;
    }

    function buildReport(record) {
        const kind = kindOf(record);
        if (kind === KIND_PARTS) return buildPartsReport(record);
        return kind === KIND_INSTALLATION ? buildInstallationReport(record) : buildServiceReport(record);
    }

    /** The installation data file. Every header and checklist field is
        present, blank or not, and every value is a string. */
    function buildInstallationReport(record) {
        const values = record.values || {};
        const fields = {};
        installationFieldNames().forEach((name) => { fields[name] = asText(values[name]).trim(); });
        return {
            format: REPORT_FORMAT,
            version: FORMAT_VERSION,
            kind: KIND_INSTALLATION,
            bq: record.bq,
            made_at: nowIso(),
            catalogue_version: asText(installationCatalogue().version),
            pack_made_on: asText(state.pack.made_on),
            fields: fields,
        };
    }

    /** The report data file. Every field of the chosen scope and every spare
        row is present, blank or not, and every value is a string. */
    function buildServiceReport(record) {
        const values = record.values || {};
        const names = BASE_KEYS
            .concat(taskFieldNames(taskListFor(values.cycle_visit).tasks))
            .concat(spareFieldNames());
        const fields = {};
        names.forEach((name) => { fields[name] = asText(values[name]).trim(); });
        return {
            format: REPORT_FORMAT,
            version: FORMAT_VERSION,
            kind: KIND_SERVICE,
            bq: record.bq,
            made_at: nowIso(),
            catalogue_version: asText(state.pack.catalogue.version),
            pack_made_on: asText(state.pack.made_on),
            deviation_found: Boolean(record.deviation_found),
            fields: fields,
        };
    }

    /** The pack in hand can describe this record: the unit is in it, and an
        installation report also needs the pack's checklist. */
    function packCovers(record) {
        if (kindOf(record) === KIND_PARTS) return partsCovered(record);
        if (!state.pack || !findUnit(record.bq)) return false;
        return kindOf(record) !== KIND_INSTALLATION || Boolean(installationCatalogue());
    }

    function touch(record) {
        record.updated_at = nowIso();
        if (packCovers(record)) record.report = buildReport(record);
        saveReports();
    }

    /* ---------------------------------------------------------------- validation
       The platform's own messages, word for word. The server checks again on
       import; this only saves the technician a wasted trip back. */
    function validate(record, unit) {
        const values = record.values;
        const errors = {};
        const trimmed = (key) => asText(values[key]).trim();
        checkVisit(trimmed("event_id"), unit, errors);
        checkServiceDate(trimmed("event_date"), errors);
        if (!trimmed("event_type")) errors.event_type = "Service type is required.";
        if (!trimmed("performed_by")) errors.performed_by = "Service performed by is required.";
        const cycle = trimmed("cycle_visit");
        if (cycle && !/^[1-8]$/.test(cycle)) errors.cycle_visit = "Choose a cycle visit from the list.";
        checkSpareRows(values, errors);
        return errors;
    }

    function checkVisit(eventId, unit, errors) {
        const open = (unit.open_visits || []).map((visit) => String(visit.id));
        if (eventId !== UNPLANNED && open.indexOf(eventId) === -1) {
            errors.event_id = "That visit is not open on this unit. Choose one from the list.";
        }
    }

    function checkServiceDate(value, errors) {
        if (!value) {
            errors.event_date = "Service date is required.";
        } else if (!isIsoDate(value)) {
            errors.event_date = "Use the date format YYYY-MM-DD, or leave it blank.";
        } else if (value > todayIso()) {
            errors.event_date = "A service cannot be completed in the future. Schedule it instead.";
        }
    }

    function checkSpareRows(values, errors) {
        state.pack.added_rows.forEach((row) => {
            const text = asText(values[row.text_field]).trim();
            const answer = asText(values[row.answer_field]).trim();
            const notes = row.notes_field ? asText(values[row.notes_field]).trim() : "";
            if (!text && (answer || notes)) errors[row.text_field] = "Describe the task, or clear this row.";
        });
    }

    function validateInstallation(record) {
        const values = record.values;
        const errors = {};
        const trimmed = (key) => asText(values[key]).trim();
        checkInstalledOn(trimmed("installed_on"), errors);
        if (!trimmed("performed_by")) errors.performed_by = "Installed by is required.";
        Object.keys(INSTALL_HEADER).forEach((key) => checkLength(key, trimmed(key), INSTALL_MAX[key], errors));
        installationCatalogue().items.forEach((item) => {
            const value = trimmed(item.field);
            checkLength(item.field, value, INSTALL_MAX.value, errors);
            if (item.section === ACTIVITY_SECTION && value && ["yes", "no"].indexOf(value.toLowerCase()) === -1) {
                errors[item.field] = "Answer yes or no, or leave it blank.";
            }
        });
        return errors;
    }

    function checkInstalledOn(value, errors) {
        if (!value) {
            errors.installed_on = "Installation date is required.";
        } else if (!isIsoDate(value)) {
            errors.installed_on = "Use the date format YYYY-MM-DD, or leave it blank.";
        } else if (value > todayIso()) {
            errors.installed_on = "An installation cannot have happened in the future.";
        }
    }

    /** A first error on a field wins, as on the platform. */
    function checkLength(name, value, limit, errors) {
        if (limit && value.length > limit && !errors[name]) {
            errors[name] = `Keep this to ${limit} characters or fewer.`;
        }
    }

    /* ---------------------------------------------------------------- the sheet
       Frozen at Finish, so the printed report cannot change if a newer pack
       with other wordings is loaded before it is sent. */
    function buildSheet(record, unit) {
        const values = record.values;
        const value = (key) => asText(values[key]).trim();
        const tasks = taskListFor(value("cycle_visit")).tasks;
        return {
            customer: orDash(unit.customer),
            site: orDash(unit.site),
            placement: orDash(unit.placement),
            bq: record.bq,
            customer_serial: orDash(unit.customer_serial),
            event_date: niceDate(value("event_date")),
            event_type: value("event_type"),
            performed_by: orDash(value("performed_by")),
            assembly_order: orDash(value("assembly_order")),
            cycle_visit: value("cycle_visit") ? `${value("cycle_visit")} of 8` : "Outside the cycle",
            template_revision: orDash(asText(state.pack.catalogue.template_revision)),
            catalogue_version: orDash(asText(state.pack.catalogue.version)),
            review: reviewRows(tasks, values),
            after_service: tasks.filter((task) => task.section !== REVIEW_SECTION).map((task) => ({
                text: task.text, answer: answerLabel(asText(values[task.answer_field]).trim()),
            })),
            comments: value("notes").split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
            deviation_found: Boolean(record.deviation_found),
        };
    }

    function buildInstallationSheet(record, unit) {
        const values = record.values;
        const value = (key) => asText(values[key]).trim();
        const row = (item) => ({ text: item.text, answer: answerLabel(value(item.field)) });
        const catalogue = installationCatalogue();
        return {
            kind: KIND_INSTALLATION,
            customer: orDash(unit.customer),
            bq: record.bq,
            installed_on: niceDate(value("installed_on")),
            performed_by: orDash(value("performed_by")),
            location: orDash(value("location")),
            customer_tag: orDash(value("customer_tag")),
            software_version: orDash(value("software_version")),
            profinet_version: orDash(value("profinet_version")),
            template_revision: orDash(asText(catalogue.template_revision)),
            catalogue_version: orDash(asText(catalogue.version)),
            activities: installationItems(ACTIVITY_SECTION).map(row),
            settings: installationItems("setting").map(row),
            notes: value("notes").split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        };
    }

    function reviewRows(tasks, values) {
        const field = (name) => (name ? asText(values[name]).trim() : "");
        const rows = tasks.filter((task) => task.section === REVIEW_SECTION).map((task) => ({
            text: task.text, answer: answerLabel(field(task.answer_field)),
            notes: field(task.notes_field), added: false,
        }));
        state.pack.added_rows.forEach((row) => {
            if (!field(row.text_field)) return;
            rows.push({
                text: field(row.text_field), answer: answerLabel(field(row.answer_field)),
                notes: field(row.notes_field), added: true,
            });
        });
        return rows;
    }

    /* ---------------------------------------------------------------- routing */
    function route() {
        const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
        const [name, id] = hash.split("/");
        return { name: name || "units", id: id || "" };
    }

    function go(hash) {
        if (window.location.hash === hash) render();
        else window.location.hash = hash;
    }

    function setNav(name) {
        const current = { report: "units", finished: "reports" }[name] || name;
        document.querySelectorAll("[data-nav]").forEach((link) => {
            if (link.getAttribute("data-nav") === current) link.setAttribute("aria-current", "page");
            else link.removeAttribute("aria-current");
        });
    }

    function render() {
        const where = route();
        setNav(where.name);
        const app = document.getElementById("app");
        const screens = {
            pack: renderPack, reports: renderReports, units: renderUnits,
            report: () => renderForm(where.id), finished: () => renderFinished(where.id),
        };
        const screen = screens[where.name] || renderUnits;
        app.innerHTML = screen();
        state.flash = "";
        afterRender(where);
    }

    function afterRender(where) {
        if (where.name === "units") applyUnitFilter();
        const summary = document.querySelector(".form-error-summary");
        if (summary) summary.scrollIntoView({ block: "start" });
    }

    /* ---------------------------------------------------------------- shared markup */
    function banners() {
        let html = "";
        if (state.storageFailed) {
            html += `<div class="form-error-summary field-banner">This iPad is not keeping your work - it lives in this tab only. Save the data file before you close the app.</div>`;
        }
        if (state.flash) html += `<div class="field-flash" role="status">${esc(state.flash)}</div>`;
        return html;
    }

    function pageHead(kicker, title, aside) {
        return `<div class="page-head"><div>${kicker ? `<div class="label">${esc(kicker)}</div>` : ""}<h1>${esc(title)}</h1></div>${aside ? `<div class="label">${esc(aside)}</div>` : ""}</div>`;
    }

    function badge(status) {
        const info = STATUS[status] || STATUS.draft;
        return `<span class="badge ${info.badge}">${esc(info.text)}</span>`;
    }

    function noPack() {
        return `<div class="field-empty"><p>No field pack is loaded on this iPad.</p><p><a class="btn btn-primary" href="#pack">Load a field pack</a></p></div>`;
    }

    /* ---------------------------------------------------------------- Pack screen */
    function renderPack() {
        const pack = state.pack;
        const summary = pack ? `
            <dl class="field-facts">
                <dt>Made on</dt><dd>${esc(niceDate(asText(pack.made_on)))}</dd>
                <dt>Units</dt><dd>${esc(pack.units.length)}</dd>
                <dt>Task catalogue</dt><dd class="mono">${esc(orDash(asText(pack.catalogue.version)))}</dd>
                <dt>Template revision</dt><dd>${esc(orDash(asText(pack.catalogue.template_revision)))}</dd>
                <dt>Installation checklist</dt><dd>${installationSummary()}</dd>
                <dt>Parts list</dt><dd>${partsSummary()}</dd>
                <dt>Reports on this iPad</dt><dd>${esc(state.reports.length)}</dd>
            </dl>` : `<p>No field pack is loaded yet.</p>`;
        return `<main class="shell shell-form">
            ${banners()}
            ${pageHead("Field pack", "Pack")}
            <div class="form-section"><h3>Loaded pack</h3>${summary}</div>
            <div class="form-section">
                <h3>${pack ? "Load a newer pack" : "Load a pack"}</h3>
                <div class="field">
                    <label for="pack-file">Field pack file</label>
                    <input class="input" type="file" id="pack-file" accept=".json,application/json">
                    <div id="pack-note" class="hint">The .json file made on the platform and sent to you. Loading a new one keeps every report already on this iPad.</div>
                </div>
            </div>
        </main>`;
    }

    function installationSummary() {
        const catalogue = installationCatalogue();
        if (!catalogue) return "Not in this pack - no installation reports";
        const due = state.pack.units.filter(installationOffered).length;
        return `<span class="mono">${esc(orDash(asText(catalogue.version)))}</span> · ${esc(due)} unit${due === 1 ? "" : "s"} due`;
    }

    function readPackFile(file) {
        const reader = new FileReader();
        reader.onload = () => acceptPackText(String(reader.result || ""));
        reader.onerror = () => packError("The file could not be read. Try loading it again.");
        reader.readAsText(file);
    }

    function acceptPackText(text) {
        const data = parseJson(text, undefined);
        if (data === undefined) {
            packError("This file is not valid JSON, so it cannot be a field pack.");
            return;
        }
        const problem = checkPack(data);
        if (problem) {
            packError(problem);
            return;
        }
        savePack(data);
        state.flash = `Loaded the field pack of ${niceDate(asText(data.made_on))} with ${data.units.length} unit${data.units.length === 1 ? "" : "s"}.`;
        render();
    }

    function packError(message) {
        const note = document.getElementById("pack-note");
        const input = document.getElementById("pack-file");
        if (note) {
            note.className = "error";
            note.textContent = message;
        }
        if (input) input.classList.add("has-error");
    }

    /* ---------------------------------------------------------------- Units screen */
    function renderUnits() {
        if (!state.pack) {
            return `<main class="shell">${banners()}${pageHead("", "Units")}${noPack()}</main>`;
        }
        const rows = state.pack.units.map(unitRow).join("");
        return `<main class="shell">
            ${banners()}
            ${pageHead(`Field pack of ${niceDate(asText(state.pack.made_on))}`, "Units", `${state.pack.units.length} units`)}
            ${partsEntry()}
            <div class="field field-search">
                <label for="unit-search">Search</label>
                <input class="input" type="search" id="unit-search" value="${esc(state.unitQuery)}"
                       placeholder="Serial, customer, site" autocomplete="off" autocorrect="off" spellcheck="false">
            </div>
            <p class="hint" id="unit-count"></p>
            <div class="table-wrap">
            <table class="table responsive field-units">
                <thead><tr><th>Unit</th><th>Customer</th><th>Site</th><th>Next visit</th><th>Report</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        </main>`;
    }

    function unitRow(unit) {
        const bq = String(unit.bq);
        const visits = Array.isArray(unit.open_visits) ? unit.open_visits : [];
        const record = latestRecordFor(bq);
        const haystack = [bq, unit.label, unit.customer, unit.site].map(asText).join(" ").toLowerCase();
        return `<tr data-search="${esc(haystack)}">
            <td data-th="Unit"><strong>${esc(unit.label || bq)}</strong></td>
            <td data-th="Customer">${esc(orDash(unit.customer))}</td>
            <td data-th="Site">${esc(orDash(unit.site))}</td>
            <td data-th="Next visit">${esc(visits.length ? visits[0].label : "None planned")}</td>
            <td data-th="Report">${record ? `${badge(record.status)} <span class="muted">${esc(KIND_TITLE[kindOf(record)])}</span>` : `<span class="muted">${DASH}</span>`}</td>
            <td data-th=""><div class="field-actions">${unitButtons(unit)}</div></td>
        </tr>`;
    }

    /** A draft resumes as the kind it is. An unplanned visit is a service
        report, so it is offered only while no service draft is waiting. */
    function unitButtons(unit) {
        const bq = String(unit.bq);
        const serviceDraft = draftFor(bq, KIND_SERVICE);
        const button = (style, action, text) => `<button class="btn ${style}" type="button"
                data-action="${action}" data-bq="${esc(bq)}">${esc(text)}</button>`;
        let html = serviceDraft
            ? button("btn-secondary", "open-unit", "Resume service draft")
            : button("btn-primary", "open-unit", "New report")
              + button("btn-secondary", "open-unplanned", "Unplanned visit");
        const installed = installationRecordFor(bq);
        if (installed && installed.status === "draft") {
            html += button("btn-secondary", "open-installation", "Resume installation");
        } else if (installed || installationOffered(unit)) {
            html += button("btn-secondary", "open-installation", "Installation report");
        }
        return html;
    }

    function applyUnitFilter() {
        const query = state.unitQuery.trim().toLowerCase();
        const rows = document.querySelectorAll("tr[data-search]");
        let shown = 0;
        rows.forEach((row) => {
            const match = !query || row.getAttribute("data-search").indexOf(query) !== -1;
            row.hidden = !match;
            if (match) shown += 1;
        });
        const count = document.getElementById("unit-count");
        if (count) count.textContent = query ? `Showing ${shown} of ${rows.length}.` : "";
    }

    function openUnit(bq, unplanned) {
        const draft = draftFor(bq, KIND_SERVICE);
        const unit = findUnit(bq);
        if (!draft && !unit) return;
        const record = draft || newRecord(unit, KIND_SERVICE, unplanned);
        state.errors = {};
        go(`#report/${encodeURIComponent(record.id)}`);
    }

    /** One installation report per unit: an existing one on this iPad is
        opened, whatever its status, rather than a second one started. */
    function openInstallation(bq) {
        const existing = installationRecordFor(bq);
        const unit = findUnit(bq);
        if (existing) {
            openReport(existing.id);
            return;
        }
        if (!unit || !installationOffered(unit)) return;
        const record = newRecord(unit, KIND_INSTALLATION, false);
        state.errors = {};
        go(`#report/${encodeURIComponent(record.id)}`);
    }

    /* ---------------------------------------------------------------- the report form */
    function note(field, hint) {
        const error = state.errors[field];
        if (error) return `<div class="error">${esc(error)}</div>`;
        return hint ? `<div class="hint">${esc(hint)}</div>` : "";
    }

    function inputClass(field) {
        return state.errors[field] ? "input has-error" : "input";
    }

    function tick(name, value, id) {
        const option = (v, text) => `<option value="${v}"${value === v ? " selected" : ""}>${text}</option>`;
        return `<select class="${inputClass(name)}" name="${esc(name)}"${id ? ` id="${esc(id)}"` : ""} aria-label="Yes or no">
            ${option("", DASH)}${option("yes", "Yes")}${option("no", "No")}
        </select>`;
    }

    function textInput(name, value, extra) {
        return `<input class="${inputClass(name)}" name="${esc(name)}" value="${esc(value)}" ${extra || ""}>`;
    }

    function renderForm(id) {
        const record = findRecord(id);
        if (!record) return `<main class="shell">${pageHead("", "Report not found")}<p>This report is not on this iPad any more. <a href="#reports">Back to reports</a></p></main>`;
        if (kindOf(record) === KIND_PARTS) return renderPartsForm(record);
        const unit = findUnit(record.bq);
        const title = KIND_TITLE[kindOf(record)];
        if (!state.pack || !unit) {
            return `<main class="shell shell-form">${pageHead(record.label, title)}<p>Unit ${esc(record.bq)} is not in the loaded field pack, so its form cannot be shown. Load the pack it came from on the <a href="#pack">Pack</a> screen.</p></main>`;
        }
        if (kindOf(record) === KIND_INSTALLATION) return renderInstallationForm(record, unit);
        state.currentId = record.id;
        const values = record.values;
        const count = Object.keys(state.errors).length;
        return `<main class="shell shell-form">
            <div class="crumb"><a href="#units">Units</a><span>${esc(record.label)}</span></div>
            ${banners()}
            ${pageHead(`${orDash(unit.customer)} · ${orDash(unit.site)}`, "Service report", "Required fields marked ∗")}
            ${count ? `<div class="form-error-summary">Nothing was saved. Check the ${count} field${count === 1 ? "" : "s"} marked below.</div>` : ""}
            <form id="report-form" novalidate autocomplete="off">
                ${whichVisitSection(unit, values)}
                ${whatHappenedSection(values)}
                <div class="form-section">
                    <h3>Service report</h3>
                    <div id="scope-block">${scopeBlock(values)}</div>
                    ${commentsBlock(record)}
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" type="submit">Finish</button>
                    <a class="btn btn-ghost" href="#units">Back to units</a>
                    <span class="spacer label">Saved on this iPad as you type.</span>
                </div>
            </form>
        </main>`;
    }

    function whichVisitSection(unit, values) {
        const visits = Array.isArray(unit.open_visits) ? unit.open_visits : [];
        const options = visits.map((visit) => {
            const value = String(visit.id);
            return `<option value="${esc(value)}"${values.event_id === value ? " selected" : ""}>${esc(visit.label)}</option>`;
        }).join("");
        const unplannedSelected = values.event_id === UNPLANNED || !visits.length;
        return `<div class="form-section">
            <h3>Which visit</h3>
            <div class="field">
                <label for="event_id">Planned visit</label>
                <select class="${inputClass("event_id")}" id="event_id" name="event_id">
                    ${options}
                    <option value="${UNPLANNED}"${unplannedSelected ? " selected" : ""}>An unplanned visit — callout, exchange</option>
                </select>
                ${note("event_id", "Closing a planned visit keeps the schedule honest. Choose unplanned for work nobody booked.")}
            </div>
        </div>`;
    }

    function whatHappenedSection(values) {
        const steps = state.pack.cycle_steps;
        const cycleOptions = steps.slice(0, 8).map((code, index) => {
            const value = String(index + 1);
            return `<option value="${value}"${values.cycle_visit === value ? " selected" : ""}>${value} of 8 — ${esc(code)}</option>`;
        }).join("");
        return `<div class="form-section">
            <h3>What happened</h3>
            <div class="cols cols-2">
                <div class="field">
                    <label for="event_date">Service date ∗</label>
                    <input class="${inputClass("event_date")}" type="date" id="event_date" name="event_date"
                           value="${esc(values.event_date)}" max="${todayIso()}">
                    ${note("event_date", "YYYY-MM-DD. The day the work was done — it cannot be in the future.")}
                </div>
                <div class="field">
                    <label for="event_type">Service type ∗</label>
                    ${textInput("event_type", values.event_type, 'id="event_type"')}
                    ${note("event_type", "What the visit was — ½ yr service, callout, pump exchange.")}
                </div>
            </div>
            <div class="cols cols-2">
                <div class="field">
                    <label for="performed_by">Service performed by ∗</label>
                    ${textInput("performed_by", values.performed_by, 'id="performed_by" autocomplete="name"')}
                    ${note("performed_by", "Who did the work. This is the signature on the report — there is no second approval.")}
                </div>
                <div class="field">
                    <label for="assembly_order">Assembly order</label>
                    ${textInput("assembly_order", values.assembly_order, 'id="assembly_order"')}
                    ${note("assembly_order", "The order this visit was booked against, where there is one.")}
                </div>
            </div>
            <div class="field">
                <label for="cycle_visit">Cycle visit</label>
                <select class="${inputClass("cycle_visit")}" id="cycle_visit" name="cycle_visit">
                    <option value="">Outside the cycle — advances nothing</option>
                    ${cycleOptions}
                </select>
                ${note("cycle_visit", "This is what moves the unit along its 8-visit cycle, and it schedules the next visit six months out. It also chooses the task list below.")}
            </div>
        </div>`;
    }

    function scopeBlock(values) {
        const list = taskListFor(values.cycle_visit);
        if (list.missing) {
            return `<p class="error">The field pack has no task list for cycle visit ${esc(values.cycle_visit)}. Make a new pack on the platform, or record this visit outside the cycle.</p>`;
        }
        if (!list.tasks.length) {
            return `<p class="hint">Work outside the 8-visit cycle has no task list — no template covers a
               callout or an exchange. Choose a cycle visit above if this was a scheduled service.</p>`;
        }
        const review = list.tasks.filter((task) => task.section === REVIEW_SECTION);
        const after = list.tasks.filter((task) => task.section !== REVIEW_SECTION);
        return `<p class="hint">Template revision ${esc(orDash(asText(state.pack.catalogue.template_revision)))}. The wording of every row is
               stored with this visit, so a later revision of the templates can never rewrite what
               you sign here. Leave a row blank if it was not recorded.</p>
            <div class="table-wrap">
            <table class="table responsive field-review">
                <thead><tr><th>To be performed</th><th>Yes / No</th><th>Notes</th></tr></thead>
                <tbody>${reviewTableRows(review, values)}${spareRows(values)}</tbody>
            </table>
            </div>
            <div class="hint">The last five rows are for work the list does not cover. They belong to
                this visit only and never join the catalogue.</div>
            ${after.length ? `<h3 class="field-subhead">Test after service</h3><div class="cols cols-2">${after.map((task) => afterServiceField(task, values)).join("")}</div>` : ""}`;
    }

    function reviewTableRows(tasks, values) {
        let group = "";
        return tasks.map((task) => {
            let head = "";
            if (task.group && task.group !== group) {
                head = `<tr class="group-head"><td data-th="Section" colspan="3"><strong>${esc(groupHeading(task.group))}</strong></td></tr>`;
                group = task.group;
            }
            const notesCell = task.notes_field
                ? `${textInput(task.notes_field, values[task.notes_field], 'aria-label="Notes"')}${note(task.notes_field)}`
                : "";
            return `${head}<tr>
                <td data-th="To be performed">${esc(task.text)}</td>
                <td data-th="Yes / No">${tick(task.answer_field, asText(values[task.answer_field]))}${note(task.answer_field)}</td>
                <td data-th="Notes">${notesCell}</td>
            </tr>`;
        }).join("");
    }

    function spareRows(values) {
        return state.pack.added_rows.map((row) => `<tr>
            <td data-th="To be performed">
                ${textInput(row.text_field, values[row.text_field], 'placeholder="Something else you did" aria-label="Added task"')}
                ${note(row.text_field)}
            </td>
            <td data-th="Yes / No">${tick(row.answer_field, asText(values[row.answer_field]))}</td>
            <td data-th="Notes">${row.notes_field ? textInput(row.notes_field, values[row.notes_field], 'aria-label="Notes"') : ""}</td>
        </tr>`).join("");
    }

    function afterServiceField(task, values) {
        const name = task.answer_field;
        const control = task.answer === TEXT_ANSWER
            ? `${textInput(name, values[name], `id="${esc(name)}"`)}${note(name, "Which procedure was run — the compressed one, or the normal one.")}`
            : `${tick(name, asText(values[name]), name)}${note(name)}`;
        return `<div class="field"><label for="${esc(name)}">${esc(task.text)}</label>${control}</div>`;
    }

    function commentsBlock(record) {
        return `<div class="field">
                <label for="notes">Comments</label>
                <textarea class="${inputClass("notes")}" id="notes" name="notes" rows="5">${esc(record.values.notes)}</textarea>
                ${note("notes", "What was done, what was found, anything the next technician needs.")}
            </div>
            <div class="field">
                <label for="deviation_found" class="field-check">
                    <input type="checkbox" id="deviation_found" data-deviation="1"${record.deviation_found ? " checked" : ""}>
                    A deviation was found on this visit
                </label>
                <div class="hint">Describe it in Comments. It is logged in the platform when the report is imported.</div>
            </div>`;
    }

    /* ---------------------------------------------------------------- the installation form
       The platform's own form: general info, activities ticked, settings as
       written on the machine, notes. */
    function renderInstallationForm(record, unit) {
        const catalogue = installationCatalogue();
        if (!catalogue) {
            return `<main class="shell shell-form">${pageHead(record.label, "Installation report")}<p>The loaded field pack has no installation checklist, so this form cannot be shown. Load a newer pack on the <a href="#pack">Pack</a> screen.</p></main>`;
        }
        state.currentId = record.id;
        const values = record.values;
        const count = Object.keys(state.errors).length;
        return `<main class="shell shell-form">
            <div class="crumb"><a href="#units">Units</a><span>${esc(record.label)} · Installation report</span></div>
            ${banners()}
            ${pageHead(`${orDash(unit.customer)} · ${orDash(unit.site)}`, "Installation report", "Required fields marked ∗")}
            ${count ? `<div class="form-error-summary">Nothing was saved. Check the ${count} field${count === 1 ? "" : "s"} marked below.</div>` : ""}
            <form id="report-form" novalidate autocomplete="off">
                ${generalInfoSection(catalogue, values)}
                ${activitySection(catalogue, values)}
                ${settingsSection(values)}
                ${installNotesSection(catalogue, values)}
                <div class="form-actions">
                    <button class="btn btn-primary" type="submit">Finish</button>
                    <a class="btn btn-ghost" href="#units">Back to units</a>
                    <span class="spacer label">Saved on this iPad as you type. A unit has one installation report.</span>
                </div>
            </form>
        </main>`;
    }

    function headerField(name, values) {
        const info = INSTALL_HEADER[name] || { label: groupHeading(name), hint: "" };
        const isDate = name === "installed_on";
        const extra = isDate
            ? `type="date" id="${esc(name)}" max="${todayIso()}"`
            : `id="${esc(name)}"${name === "performed_by" ? ' autocomplete="name"' : ""}`;
        return `<div class="field">
            <label for="${esc(name)}">${esc(info.label)}${info.required ? " ∗" : ""}</label>
            ${textInput(name, asText(values[name]), extra)}
            ${note(name, info.hint)}
        </div>`;
    }

    /** The header in the pack's order, two to a row; notes get a section of their own. */
    function generalInfoSection(catalogue, values) {
        const names = catalogue.header_fields.map(String).filter((name) => name !== "notes");
        let rows = "";
        for (let i = 0; i < names.length; i += 2) {
            rows += `<div class="cols cols-2">${names.slice(i, i + 2).map((name) => headerField(name, values)).join("")}</div>`;
        }
        return `<div class="form-section"><h3>General info</h3>${rows}</div>`;
    }

    function activitySection(catalogue, values) {
        const items = installationItems(ACTIVITY_SECTION);
        if (!items.length) return "";
        const rows = items.map((item) => `<tr>
                <td data-th="To be performed">${esc(item.text)}</td>
                <td data-th="Yes / No">${tick(item.field, asText(values[item.field]))}${note(item.field)}</td>
            </tr>`).join("");
        return `<div class="form-section">
            <h3>Activity</h3>
            <p class="hint">Template revision ${esc(orDash(asText(catalogue.template_revision)))}. The wording of every row is
               stored with this report, so a later revision cannot rewrite what you sign here.</p>
            <div class="table-wrap">
            <table class="table responsive field-review">
                <thead><tr><th>To be performed</th><th>Yes / No</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        </div>`;
    }

    function settingsSection(values) {
        const items = installationItems("setting");
        if (!items.length) return "";
        const fields = items.map((item) => `<div class="field">
                <label for="${esc(item.field)}">${esc(item.text)}</label>
                ${textInput(item.field, asText(values[item.field]), `id="${esc(item.field)}"`)}
                ${note(item.field)}
            </div>`).join("");
        return `<div class="form-section">
            <h3>Settings</h3>
            <div class="cols cols-2">${fields}</div>
            <div class="hint">These are recorded here, on the report. They do not start the
                configuration register — a three-value reading would make every later diff show
                forty-eight parameters as new.</div>
        </div>`;
    }

    function installNotesSection(catalogue, values) {
        if (catalogue.header_fields.map(String).indexOf("notes") === -1) return "";
        return `<div class="form-section">
            <h3>Notes</h3>
            <div class="field">
                <label for="notes">Notes</label>
                <textarea class="${inputClass("notes")}" id="notes" name="notes" rows="4">${esc(values.notes)}</textarea>
                ${note("notes", INSTALL_HEADER.notes.hint)}
            </div>
        </div>`;
    }

    function currentRecord() {
        return findRecord(state.currentId);
    }

    function onFormEdit(target, isChange) {
        const record = currentRecord();
        if (!record) return;
        if (target.hasAttribute("data-deviation")) {
            record.deviation_found = target.checked;
        } else if (target.name) {
            record.values[target.name] = target.value;
        } else {
            return;
        }
        touch(record);
        if (isChange && target.name === "cycle_visit") {
            const block = document.getElementById("scope-block");
            if (block) block.innerHTML = scopeBlock(record.values);
        }
    }

    function finish() {
        const record = currentRecord();
        const unit = record ? findUnit(record.bq) : null;
        if (!record || !unit || !packCovers(record)) return;
        const isInstallation = kindOf(record) === KIND_INSTALLATION;
        state.errors = isInstallation ? validateInstallation(record) : validate(record, unit);
        if (Object.keys(state.errors).length) {
            render();
            return;
        }
        record.status = "finished";
        record.sheet = isInstallation ? buildInstallationSheet(record, unit) : buildSheet(record, unit);
        touch(record);
        go(`#finished/${encodeURIComponent(record.id)}`);
    }

    /* ---------------------------------------------------------------- the finished report */
    function renderFinished(id) {
        const record = findRecord(id);
        if (!record || !record.sheet || record.status === "draft") {
            return `<main class="shell">${pageHead("", "No finished report")}<p>This report is not finished. <a href="#reports">Back to reports</a></p></main>`;
        }
        state.currentId = record.id;
        return `<div class="field-finished">
            <div class="report-bar">
                <a href="#reports">← Reports</a>
                ${badge(record.status)}
                <span class="spacer"></span>
                <button class="btn btn-ghost" type="button" data-action="edit">Edit</button>
                ${record.status === "sent" ? "" : `<button class="btn btn-secondary" type="button" data-action="mark-sent">Mark as sent</button>`}
                <button class="btn btn-secondary" type="button" data-action="save-file">Save data file</button>
                <button class="btn btn-primary" type="button" data-action="print">Print / Save as PDF</button>
            </div>
            <div class="field-bar-notes">${banners()}</div>
            ${finishedMarkup(record)}
        </div>`;
    }

    function finishedMarkup(record) {
        const kind = kindOf(record);
        if (kind === KIND_PARTS) return partsSheetMarkup(record.sheet);
        return kind === KIND_INSTALLATION ? installationSheetMarkup(record.sheet) : sheetMarkup(record.sheet);
    }

    function sheetMarkup(sheet) {
        const info = [["Customer", sheet.customer], ["Site", sheet.site], ["Placement", sheet.placement],
            ["BQOL serial", sheet.bq], ["Customer serial", sheet.customer_serial], ["Date", sheet.event_date],
            ["Service performed by", sheet.performed_by], ["Assembly order", sheet.assembly_order],
            ["Cycle visit", sheet.cycle_visit]];
        return `<article class="report-sheet field-sheet">
            <header class="report-head">
                <span class="brand-text">BactiQuant</span>
                <div class="title"><h1>Service report</h1><div>${esc(sheet.event_type)} · ${esc(sheet.event_date)}</div></div>
            </header>
            <section class="report-info">${info.map(([label, value]) => `<div><b>${esc(label)}</b>${esc(value)}</div>`).join("")}</section>
            ${sheetReview(sheet.review)}
            ${sheetAfterService(sheet.after_service)}
            ${sheet.deviation_found ? `<section class="report-section report-deviations"><h2>Deviation found on this visit</h2><p>See Comments.</p></section>` : ""}
            <section class="report-section">
                <h2>Comments</h2>
                ${sheet.comments.length ? sheet.comments.map((line) => `<p>${esc(line)}</p>`).join("") : "<p>None.</p>"}
            </section>
            <section class="report-sign">
                <div>Service performed by: ${esc(sheet.performed_by)}</div>
                <div>Customer signature and date</div>
            </section>
            <footer class="report-foot">
                <span>Template revision ${esc(sheet.template_revision)} · task catalogue ${esc(sheet.catalogue_version)}</span>
            </footer>
        </article>`;
    }

    function resultClass(answer) {
        if (answer === "Yes") return "result result-yes";
        if (answer === "No") return "result result-no";
        return "result";
    }

    /* The installation report as one A4 sheet, laid out as the platform's
       installation_print.html. */
    function installationSheetMarkup(sheet) {
        const info = [["Customer", sheet.customer], ["Installation location", sheet.location],
            ["BQOL serial number", sheet.bq], ["Customer tag number", sheet.customer_tag],
            ["BQOL software version", sheet.software_version],
            ["Profinet module, software version", sheet.profinet_version],
            ["Date and initials", `${sheet.installed_on} · ${sheet.performed_by}`]];
        const activities = sheet.activities.map((row) => `<tr>
                <td>${esc(row.text)}</td><td class="${resultClass(row.answer)}">${esc(row.answer)}</td>
            </tr>`).join("");
        const settings = sheet.settings.map((row) => `<tr><td>${esc(row.text)}</td><td class="result">${esc(row.answer)}</td></tr>`).join("");
        return `<article class="report-sheet field-sheet">
            <header class="report-head">
                <span class="brand-text">BactiQuant</span>
                <div class="title"><h1>Installation report</h1><div>${esc(sheet.bq)} · ${esc(sheet.installed_on)}</div></div>
            </header>
            <section class="report-info">${info.map(([label, value]) => `<div><b>${esc(label)}</b>${esc(value)}</div>`).join("")}</section>
            <section class="report-section">
                <h2>Activity</h2>
                <table class="report-table">
                    <thead><tr><th>To be performed</th><th>Yes / No</th></tr></thead>
                    <tbody>${activities}</tbody>
                </table>
            </section>
            <section class="report-section">
                <h2>Settings</h2>
                <table class="report-table"><tbody>${settings}</tbody></table>
            </section>
            <section class="report-section">
                <h2>Notes</h2>
                ${sheet.notes.length ? sheet.notes.map((line) => `<p>${esc(line)}</p>`).join("") : "<p>None.</p>"}
            </section>
            <section class="report-sign">
                <div>Installed by: ${esc(sheet.performed_by)}</div>
                <div>Customer signature and date</div>
            </section>
            <footer class="report-foot">
                <span>Template revision ${esc(sheet.template_revision)} · catalogue ${esc(sheet.catalogue_version)}</span>
            </footer>
        </article>`;
    }

    /** No rows - work outside the cycle - means no section: an empty table
        on a signed sheet reads as a checklist nobody filled in. */
    function sheetReview(rows) {
        if (!rows.length) return "";
        const body = rows.map((row) => `<tr>
                <td>${esc(row.text)}${row.added ? " <em>(added on the day)</em>" : ""}</td>
                <td class="${resultClass(row.answer)}">${esc(row.answer)}</td>
                <td class="notes">${esc(row.notes)}</td>
            </tr>`).join("");
        return `<section class="report-section">
            <h2>Review of the system</h2>
            <table class="report-table">
                <thead><tr><th>To be performed</th><th>Result</th><th>Notes</th></tr></thead>
                <tbody>${body}</tbody>
            </table>
        </section>`;
    }

    function sheetAfterService(rows) {
        if (!rows.length) return "";
        return `<section class="report-section">
            <h2>Test after service</h2>
            <table class="report-table">
                <thead><tr><th>Check</th><th>Result</th></tr></thead>
                <tbody>${rows.map((row) => `<tr><td>${esc(row.text)}</td><td class="result">${esc(row.answer)}</td></tr>`).join("")}</tbody>
            </table>
        </section>`;
    }

    function reportFileName(report, record) {
        const safe = (value) => asText(value).replace(/[^A-Za-z0-9._-]/g, "_");
        if (report.kind === KIND_PARTS) {
            return `parts-site${safe(report.site_id)}-${safe(record.parts.trip_date)}.json`;
        }
        if (report.kind === KIND_INSTALLATION) {
            return `installation-${safe(report.bq)}-${safe(report.fields.installed_on)}.json`;
        }
        return `report-${safe(report.bq)}-${safe(report.fields.event_date)}.json`;
    }

    async function saveDataFile() {
        const record = currentRecord();
        if (!record || !record.report) return;
        const json = JSON.stringify(record.report, null, 2);
        const name = reportFileName(record.report, record);
        const file = makeFile(json, name);
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: name });
                showFlash(`Shared ${name}. Mark the report as sent once it has gone.`);
                return;
            } catch (error) {
                if (error && error.name === "AbortError") return;
            }
        }
        downloadText(json, name);
        showFlash(`Saved ${name}. Send it to the office, then mark the report as sent.`);
    }

    function makeFile(text, name) {
        try {
            return new File([text], name, { type: "application/json" });
        } catch (error) {
            return null;
        }
    }

    function downloadText(text, name) {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function showFlash(message) {
        state.flash = message;
        render();
    }

    function markSent() {
        const record = currentRecord();
        if (!record) return;
        record.status = "sent";
        touch(record);
        showFlash("Marked as sent.");
    }

    function editRecord() {
        const record = currentRecord();
        if (!record) return;
        record.status = "draft";
        record.sheet = null;
        if (kindOf(record) === KIND_PARTS) record.parts.step = "lines";
        state.errors = {};
        touch(record);
        go(`#report/${encodeURIComponent(record.id)}`);
    }

    /* ---------------------------------------------------------------- parts used
       One sheet per trip to one site: which units were serviced, and a line
       per billable item. The field names come from the pack's `parts_sheet`
       (the platform's parts_sheet.py); the draft keeps plain values and
       the report file maps them onto those names at the last moment.
       Whether a line is invoiced is looked up in the pack's resolved billing
       table - the rule itself is never run here. */

    /** The pack's parts sheet, or null. An older pack has none, and then no
        "Parts used" is offered - never an error. */
    function partsPack() {
        const pack = state.pack;
        if (!pack || !pack.parts || !pack.billing || !pack.parts_sheet) return null;
        const sheet = pack.parts_sheet;
        if (!Array.isArray(pack.parts.items) || !pack.billing.table || !sheet.header
            || !Array.isArray(sheet.lines) || !Array.isArray(pack.sites)
            || !Array.isArray(pack.technicians)) return null;
        return pack;
    }

    function headerName(key) {
        return asText(state.pack.parts_sheet.header[key]);
    }

    function rowNames(index) {
        return state.pack.parts_sheet.lines[index] || {};
    }

    function isTripKind(kind) {
        const kinds = state.pack.parts_sheet.trip_kinds;
        return Array.isArray(kinds) && kinds.indexOf(kind) !== -1;
    }

    function findSite(id) {
        if (!partsPack() || !id) return null;
        return state.pack.sites.find((site) => String(site.id) === String(id)) || null;
    }

    function findTechnician(id) {
        if (!partsPack() || !id) return null;
        return state.pack.technicians.find((tech) => String(tech.id) === String(id)) || null;
    }

    function findItem(number) {
        const wanted = asText(number).trim();
        if (!wanted || !partsPack()) return null;
        return state.pack.parts.items.find((item) => String(item.number) === wanted) || null;
    }

    function itemsOfKind(kind) {
        return state.pack.parts.items.filter((item) => item.kind === kind);
    }

    function siteUnits(siteId) {
        return state.pack.units.filter((unit) => String(unit.site_id) === String(siteId));
    }

    function unitLabel(bq) {
        const unit = findUnit(bq);
        return unit && unit.label ? unit.label : String(bq);
    }

    function siteLabel(site) {
        return site ? `${orDash(site.customer)} · ${orDash(site.label)}` : KIND_TITLE[KIND_PARTS];
    }

    function visitTypeLabel(key) {
        const types = state.pack.billing.visit_types || {};
        return asText(types[key]) || asText(key);
    }

    function partsCovered(record) {
        if (!partsPack() || !record.parts) return false;
        return !record.parts.site_id || Boolean(findSite(record.parts.site_id));
    }

    /** The site's agreement on the trip day. The one piece of date logic
        the app does, and the same as billing.agreement_on: an agreement past
        its expiry is no agreement. Everything after that is a lookup. */
    function agreementOn(site, tripDate) {
        const agreement = (site && site.agreement) || {};
        const kind = asText(agreement.kind) || AGREEMENT_NONE;
        const expires = asText(agreement.expires);
        if (kind !== AGREEMENT_NONE && expires && isIsoDate(tripDate) && expires < tripDate) {
            return { kind: AGREEMENT_NONE, expired: true, expires: expires };
        }
        return { kind: kind, expired: false, expires: expires };
    }

    /** What the pack's table says for one kind of line on this trip. A
        missing cell - a pack whose rules could not cover it - is invoiced,
        as the platform does: a wrong invoice is credited, a missed one is lost. */
    function ruleFor(parts, kind) {
        const agreement = agreementOn(findSite(parts.site_id), parts.trip_date).kind;
        const byType = (state.pack.billing.table[agreement] || {})[parts.visit_type] || {};
        const cell = byType[kind];
        if (!cell) return { invoice: "yes", reason: "No billing rule in the pack for this line - invoiced." };
        return { invoice: cell.invoice === true ? "yes" : "no", reason: asText(cell.reason) };
    }

    /** A line nobody has overruled follows the rule; an overruled one is left alone. */
    function applyRule(parts, line) {
        if (!line.manual) line.invoice = ruleFor(parts, line.kind).invoice;
    }

    function applyRules(parts) {
        parts.lines.forEach((line) => applyRule(parts, line));
    }

    function isOverruled(parts, line) {
        return Boolean(line.invoice) && line.invoice !== ruleFor(parts, line.kind).invoice;
    }

    /** A one-unit trip puts every unit line on that unit; a trip line names none. */
    function lineUnits(parts, line) {
        if (isTripKind(line.kind)) return [];
        if (parts.units.length === 1) return parts.units.slice();
        return line.units.filter((bq) => parts.units.indexOf(bq) !== -1);
    }

    function isFilled(line) {
        return Boolean(asText(line.number).trim() || asText(line.quantity).trim());
    }

    function quantityNumber(text) {
        const value = asText(text).trim();
        if (!QUANTITY.test(value)) return null;
        const number = Number(value.replace(",", "."));
        return number > 0 ? number : null;
    }

    /** For the screen and the logistics sheet only; the platform works the
        stored total out again from the quantity and the units. */
    function totalQuantity(parts, line) {
        const number = quantityNumber(line.quantity);
        if (number === null) return "";
        const total = isTripKind(line.kind) ? number : number * lineUnits(parts, line).length;
        return String(Math.round(total * 100) / 100);
    }

    function newLine(parts, kind, number, quantity, units) {
        const line = { kind: kind, number: number || "", quantity: quantity || "",
            units: units || [], invoice: "", manual: false, storage: "", auto: false };
        if (!isTripKind(kind) && !line.units.length && parts.units.length === 1) line.units = parts.units.slice();
        applyRule(parts, line);
        return line;
    }

    /** The visit type a sheet starts on for this customer's agreement. The
        rules file says which (`starts_as`), so the app never names a visit
        type itself; an older pack without it starts on the first type. */
    function startingVisitType(parts) {
        const billing = state.pack.billing;
        const types = Object.keys(billing.visit_types || {});
        const agreement = agreementOn(findSite(parts.site_id), parts.trip_date).kind;
        const wanted = asText((billing.starts_as || {})[agreement]);
        return types.indexOf(wanted) !== -1 ? wanted : (types[0] || "");
    }

    /** A visit arranged from the service cycle, whose visit line starts with
        the unit's next cycle visit - the rules file's `cycle_visit_types`. */
    function isCycleVisitType(visitType) {
        const listed = state.pack.billing.cycle_visit_types;
        return Array.isArray(listed) && listed.indexOf(visitType) !== -1;
    }

    function newPartsValues() {
        const techs = state.pack.technicians;
        const parts = {
            step: "start",
            site_id: "",
            trip_date: todayIso(),
            visit_type: "",
            technician_id: techs.length === 1 ? String(techs[0].id) : "",
            units: [],
            notes: "",
            lines: [],
            prefilled: false,
            kitted: [],
        };
        parts.visit_type = startingVisitType(parts);
        return parts;
    }

    function newParts() {
        if (!partsPack()) return;
        const record = {
            id: newId(), kind: KIND_PARTS, label: KIND_TITLE[KIND_PARTS], status: "draft",
            updated_at: nowIso(), parts: newPartsValues(), sheet: null, report: null,
        };
        record.report = buildPartsReport(record);
        state.reports.push(record);
        saveReports();
        state.errors = {};
        go(`#report/${encodeURIComponent(record.id)}`);
    }

    /** First time through: the visit line, and each unit's kits. Later, a
        unit ticked since gets its kits and one unticked loses the ones it
        was given - nothing the technician added is touched. */
    function fitLinesToUnits(parts) {
        parts.lines.forEach((line) => { line.units = line.units.filter((bq) => parts.units.indexOf(bq) !== -1); });
        parts.lines = parts.lines.filter((line) => !(line.auto && !line.units.length));
        parts.kitted = parts.kitted.filter((bq) => parts.units.indexOf(bq) !== -1);
        if (!parts.prefilled) {
            const first = findUnit(parts.units[0]);
            const prefill = (first && first.parts_prefill) || {};
            const visitItem = isCycleVisitType(parts.visit_type) ? asText(prefill.visit_item) : "";
            parts.lines.unshift(newLine(parts, LINE_VISIT, visitItem, "1", []));
            parts.prefilled = true;
        }
        parts.units.forEach((bq) => {
            if (parts.kitted.indexOf(bq) === -1) addKitLines(parts, findUnit(bq));
        });
    }

    function addKitLines(parts, unit) {
        if (!unit) return;
        const prefill = unit.parts_prefill || {};
        const kits = Array.isArray(prefill.kit_items) ? prefill.kit_items : [];
        kits.forEach((kit) => {
            if (!findItem(kit.number) || parts.lines.length >= state.pack.parts_sheet.lines.length) return;
            const line = newLine(parts, LINE_KIT, asText(kit.number), asText(kit.quantity) || "1", [String(unit.bq)]);
            line.units = [String(unit.bq)];
            line.auto = true;
            parts.lines.push(line);
        });
        parts.kitted.push(String(unit.bq));
    }

    /* -------- the screens */
    function partsEntry() {
        if (!partsPack()) return "";
        const drafts = state.reports.filter((record) => kindOf(record) === KIND_PARTS && record.status === "draft").length;
        const waiting = drafts ? `<span class="hint">${esc(drafts)} parts sheet${drafts === 1 ? "" : "s"} in progress - open ${drafts === 1 ? "it" : "them"} from <a href="#reports">Reports</a>.</span>` : "";
        return `<div class="field-actions parts-entry">
            ${waiting}
            <button class="btn btn-primary" type="button" data-action="new-parts">Parts used</button>
        </div>`;
    }

    function partsSummary() {
        if (!partsPack()) return "Not in this pack - no parts sheet";
        const pack = state.pack;
        const provisional = pack.billing.confirmed ? "" : " (provisional)";
        return `<span class="mono">${esc(orDash(asText(pack.parts.version)))}</span> · ${esc(pack.parts.items.length)} items · billing rules <span class="mono">${esc(orDash(asText(pack.billing.version)))}</span>${esc(provisional)}`;
    }

    function renderPartsForm(record) {
        if (!partsPack()) {
            return `<main class="shell shell-form">${pageHead(record.label, "Parts used")}<p>The loaded field pack has no parts list, so this sheet cannot be shown. Load a newer pack on the <a href="#pack">Pack</a> screen.</p></main>`;
        }
        if (!partsCovered(record)) {
            return `<main class="shell shell-form">${pageHead(record.label, "Parts used")}<p>This site is not in the loaded field pack. Load the pack it came from on the <a href="#pack">Pack</a> screen.</p></main>`;
        }
        state.currentId = record.id;
        const parts = record.parts;
        const count = Object.keys(state.errors).length;
        const body = parts.step === "lines" ? partsLinesStep(parts) : partsStartStep(parts);
        return `<main class="shell shell-form">
            <div class="crumb"><a href="#units">Units</a><span>${esc(record.label)} · Parts used</span></div>
            ${banners()}
            ${pageHead(parts.step === "lines" ? siteLabel(findSite(parts.site_id)) : "One sheet per trip to one site", "Parts used", parts.step === "lines" ? "Step 2 of 2 · Lines" : "Step 1 of 2 · The trip")}
            ${partsNotices(parts)}
            ${count ? `<div class="form-error-summary">Nothing was saved. Check the ${count} field${count === 1 ? "" : "s"} marked below.</div>` : ""}
            <form id="parts-form" novalidate autocomplete="off">${body}</form>
        </main>`;
    }

    function partsNotices(parts) {
        let html = "";
        if (!state.pack.billing.confirmed) {
            html += `<p class="hint">The billing rules are provisional - the office may still change what is invoiced.</p>`;
        }
        const agreement = agreementOn(findSite(parts.site_id), parts.trip_date);
        if (agreement.expired) {
            html += `<div class="form-error-summary field-banner">The site's agreement expired on ${esc(niceDate(agreement.expires))}. This trip is treated as having no agreement - check with the office if that is wrong.</div>`;
        }
        return html;
    }

    function partsStartStep(parts) {
        const types = state.pack.billing.visit_types || {};
        const typeOptions = Object.keys(types).map((key) => `<option value="${esc(key)}"${parts.visit_type === key ? " selected" : ""}>${esc(types[key])}</option>`).join("");
        const techOptions = state.pack.technicians.map((tech) => `<option value="${esc(tech.id)}"${String(parts.technician_id) === String(tech.id) ? " selected" : ""}>${esc(tech.name)}${tech.initials ? ` (${esc(tech.initials)})` : ""}</option>`).join("");
        return `<div class="form-section">
                <h3>The trip</h3>
                <div class="field">
                    <label for="parts-site">Site ∗</label>
                    <select class="${inputClass(headerName("site_id"))}" id="parts-site" data-head="site_id">
                        <option value="">Choose the site</option>${siteOptions(parts)}
                    </select>
                    ${note(headerName("site_id"), agreementHint(parts))}
                </div>
                <div class="cols cols-2">
                    <div class="field">
                        <label for="parts-date">Trip date ∗</label>
                        <input class="${inputClass(headerName("trip_date"))}" type="date" id="parts-date" data-head="trip_date" value="${esc(parts.trip_date)}" max="${todayIso()}">
                        ${note(headerName("trip_date"), "The day of the visit - it cannot be in the future.")}
                    </div>
                    <div class="field">
                        <label for="parts-type">Visit type ∗</label>
                        <select class="${inputClass(headerName("visit_type"))}" id="parts-type" data-head="visit_type">${typeOptions}</select>
                        ${note(headerName("visit_type"), "Set from the customer's agreement. Change it when the customer called us out.")}
                    </div>
                </div>
                <div class="field">
                    <label for="parts-tech">Technician ∗</label>
                    <select class="${inputClass(headerName("technician_id"))}" id="parts-tech" data-head="technician_id">
                        <option value="">Choose who did the work</option>${techOptions}
                    </select>
                    ${note(headerName("technician_id"), "This is the signature on the sheet.")}
                </div>
            </div>
            <div class="form-section">
                <h3>Units serviced</h3>
                ${tripUnitBoxes(parts)}
            </div>
            <div class="form-actions">
                <button class="btn btn-primary" type="submit">Next: lines</button>
                <a class="btn btn-ghost" href="#units">Back to units</a>
                <span class="spacer label">Saved on this iPad as you type.</span>
            </div>`;
    }

    /** Sites grouped by customer, in the pack's order. */
    function siteOptions(parts) {
        let html = "";
        let customer = null;
        state.pack.sites.forEach((site) => {
            if (site.customer !== customer) {
                if (customer !== null) html += "</optgroup>";
                customer = site.customer;
                html += `<optgroup label="${esc(orDash(customer))}">`;
            }
            html += `<option value="${esc(site.id)}"${String(parts.site_id) === String(site.id) ? " selected" : ""}>${esc(site.label)}</option>`;
        });
        return customer === null ? html : `${html}</optgroup>`;
    }

    function agreementHint(parts) {
        const site = findSite(parts.site_id);
        if (!site) return "Only the units at the chosen site are offered below.";
        const agreement = agreementOn(site, parts.trip_date);
        const expires = agreement.expires ? `, until ${niceDate(agreement.expires)}` : "";
        const kind = asText((site.agreement || {}).kind) || AGREEMENT_NONE;
        return `${AGREEMENT_LABEL[kind] || kind}${expires}.`;
    }

    function tripUnitBoxes(parts) {
        const key = headerName("units");
        if (!parts.site_id) return `<p class="hint">Choose the site first.</p>${note(key)}`;
        const units = siteUnits(parts.site_id);
        if (!units.length) return `<p class="hint">The pack holds no units at this site.</p>${note(key)}`;
        const boxes = units.map((unit) => {
            const bq = String(unit.bq);
            return `<label class="field-check"><input type="checkbox" data-trip-unit="${esc(bq)}"${parts.units.indexOf(bq) !== -1 ? " checked" : ""}> ${esc(unit.label || bq)}</label>`;
        }).join("");
        return `<div class="parts-units">${boxes}</div>${note(key, "Tick every unit serviced on this trip. Lines can only go into these.")}`;
    }

    function partsLinesStep(parts) {
        const tech = findTechnician(parts.technician_id);
        const full = parts.lines.length >= state.pack.parts_sheet.lines.length;
        const adds = ADD_BUTTONS.map(([kind, text]) => `<button class="btn btn-secondary" type="button" data-action="add-row" data-kind="${esc(kind)}"${full ? " disabled" : ""}>${esc(text)}</button>`).join("");
        return `<div class="form-section">
                <h3>The trip</h3>
                <dl class="field-facts">
                    <dt>Date</dt><dd>${esc(niceDate(parts.trip_date))}</dd>
                    <dt>Visit type</dt><dd>${esc(visitTypeLabel(parts.visit_type))}</dd>
                    <dt>Technician</dt><dd>${esc(tech ? tech.name : DASH)}</dd>
                    <dt>Units</dt><dd>${esc(parts.units.map(unitLabel).join(", "))}</dd>
                </dl>
                <p><button class="btn btn-ghost" type="button" data-action="parts-start">Change the trip</button></p>
            </div>
            <div class="form-section">
                <h3>Lines</h3>
                ${parts.lines.length ? "" : note(rowNames(0).number)}
                <div id="parts-rows">${parts.lines.map((line, index) => partsRow(parts, line, index)).join("") || `<p class="hint">No lines yet.</p>`}</div>
                <div class="field-actions parts-add">${adds}</div>
                ${full ? `<p class="hint">The sheet holds ${esc(state.pack.parts_sheet.lines.length)} lines, and they are all in use.</p>` : ""}
            </div>
            <div class="form-section">
                <div class="field">
                    <label for="parts-notes">Notes</label>
                    <textarea class="${inputClass(headerName("notes"))}" id="parts-notes" data-head="notes" rows="4">${esc(parts.notes)}</textarea>
                    ${note(headerName("notes"), "Anything logistics needs to know.")}
                </div>
            </div>
            <div class="form-actions">
                <button class="btn btn-primary" type="submit">Finish</button>
                <a class="btn btn-ghost" href="#units">Back to units</a>
                <span class="spacer label">Saved on this iPad as you type.</span>
            </div>`;
    }

    function partsRow(parts, line, index) {
        return `<div class="parts-row${isOverruled(parts, line) ? " is-overruled" : ""}" id="parts-row-${index}">
            <div class="parts-row-head">
                <strong>${esc(KIND_LABEL[line.kind] || line.kind)}</strong>
                <button class="btn btn-ghost" type="button" data-action="remove-row" data-row="${index}">Remove</button>
            </div>
            <div class="cols cols-2">${itemField(line, index)}${quantityField(parts, line, index)}</div>
            ${isTripKind(line.kind) ? "" : unitField(parts, line, index)}
            <div class="cols cols-2">${invoiceField(parts, line, index)}${storageField(line, index)}</div>
        </div>`;
    }

    /* -------- the item picker: one box. Tapping it lists every item of the
       line's kind to scroll through; typing narrows the same list. Only a
       tap on the list chooses, so a typed number can never be a stray one. */

    function itemText(item) {
        return item ? `${item.number} – ${item.description}` : "";
    }

    function itemField(line, index) {
        const key = rowNames(index).number;
        const item = findItem(line.number);
        const chosen = item && item.kind === line.kind ? item : null;
        return `<div class="field parts-pick" data-picker="${index}">
            <label for="parts-pick-${index}">Item ∗</label>
            <input class="${inputClass(key)}" id="parts-pick-${index}" value="${esc(itemText(chosen))}" data-pick="${index}" placeholder="Tap to choose, or type to search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            <div class="parts-pick-list" id="parts-pick-list-${index}" hidden></div>
            ${note(key)}
        </div>`;
    }

    /** Every item of the line's kind whose number or description holds each
        word typed - "o-ring 2.00" finds the 2.00 O-ring. */
    function matchingItems(kind, query) {
        const words = asText(query).toLowerCase().split(/\s+/).filter(Boolean);
        return itemsOfKind(kind).filter((item) => {
            const text = `${item.number} ${item.description}`.toLowerCase();
            return words.every((word) => text.indexOf(word) !== -1);
        });
    }

    function showPicker(input, query) {
        const index = Number(input.getAttribute("data-pick"));
        const parts = currentParts() ? currentParts().parts : null;
        const line = parts ? parts.lines[index] : null;
        const list = document.getElementById(`parts-pick-list-${index}`);
        if (!line || !list) return;
        const items = matchingItems(line.kind, query);
        list.innerHTML = items.length
            ? items.map((item) => `<button class="parts-pick-option${item.number === line.number ? " is-chosen" : ""}" type="button" data-action="pick-item" data-row="${index}" data-number="${esc(item.number)}">${esc(itemText(item))}</button>`).join("")
            : `<p class="hint">Nothing matches. Clear the box to see the whole list.</p>`;
        list.hidden = false;
    }

    /** Close every open list, putting each box back to the item it holds -
        a search that was never picked from changes nothing. */
    function closePickers(except) {
        document.querySelectorAll(".parts-pick-list").forEach((list) => {
            if (list.hidden || (except && except.contains(list))) return;
            list.hidden = true;
            const index = Number(list.id.replace("parts-pick-list-", ""));
            const record = currentParts();
            const line = record ? record.parts.lines[index] : null;
            const input = document.getElementById(`parts-pick-${index}`);
            const item = line ? findItem(line.number) : null;
            if (input) input.value = itemText(item && item.kind === line.kind ? item : null);
        });
    }

    function pickItem(el) {
        const record = currentParts();
        const index = Number(el.getAttribute("data-row"));
        const line = record ? record.parts.lines[index] : null;
        if (!line) return;
        line.number = el.getAttribute("data-number");
        delete state.errors[rowNames(index).number];
        touch(record);
        if (document.activeElement) document.activeElement.blur();
        refreshRow(record.parts, index);
    }

    function onFocusIn(event) {
        const input = event.target.closest ? event.target.closest("[data-pick]") : null;
        closePickers(input ? input.closest(".parts-pick") : null);
        if (input) {
            input.value = "";
            showPicker(input, "");
        }
    }

    function totalHint(parts, line) {
        if (isTripKind(line.kind)) return "Once for the whole trip, however many units.";
        const count = lineUnits(parts, line).length;
        return `Per unit · × ${count} unit${count === 1 ? "" : "s"} = ${totalQuantity(parts, line) || DASH}`;
    }

    function quantityField(parts, line, index) {
        const key = rowNames(index).quantity;
        const error = state.errors[key];
        return `<div class="field">
            <label for="parts-qty-${index}">Quantity ∗</label>
            <input class="${inputClass(key)}" id="parts-qty-${index}" inputmode="decimal" value="${esc(line.quantity)}" data-row="${index}" data-cell="quantity" autocomplete="off">
            ${error ? note(key) : `<div class="hint" data-total="${index}">${esc(totalHint(parts, line))}</div>`}
        </div>`;
    }

    function unitField(parts, line, index) {
        const key = rowNames(index).units;
        if (parts.units.length === 1) {
            return `<div class="field"><span class="label">Unit</span><div>${esc(unitLabel(parts.units[0]))}</div>${note(key)}</div>`;
        }
        const boxes = parts.units.map((bq) => `<label class="field-check"><input type="checkbox" data-row="${index}" data-unit="${esc(bq)}"${line.units.indexOf(bq) !== -1 ? " checked" : ""}> ${esc(unitLabel(bq))}</label>`).join("");
        return `<fieldset class="field parts-units">
            <legend class="label">Units it went into ∗</legend>
            ${boxes}
            <button class="btn btn-ghost" type="button" data-action="row-all" data-row="${index}">All ${esc(parts.units.length)}</button>
            ${note(key)}
        </fieldset>`;
    }

    function invoiceField(parts, line, index) {
        const key = rowNames(index).invoice;
        const rule = ruleFor(parts, line.kind);
        const overruled = isOverruled(parts, line);
        const option = (value, text) => `<option value="${value}"${line.invoice === value ? " selected" : ""}>${text}</option>`;
        const why = overruled
            ? `<strong>Overruled</strong> - the rule says ${answerLabel(rule.invoice)}: ${esc(rule.reason)}`
            : esc(rule.reason);
        return `<div class="field">
            <label for="parts-inv-${index}">Invoice</label>
            <select class="${inputClass(key)}${overruled ? " parts-overruled" : ""}" id="parts-inv-${index}" data-row="${index}" data-cell="invoice">
                ${option("yes", "Yes")}${option("no", "No")}
            </select>
            ${state.errors[key] ? note(key) : `<div class="hint">${why}</div>`}
        </div>`;
    }

    function storageField(line, index) {
        const key = rowNames(index).storage;
        const places = state.pack.parts.storage_locations || [];
        const options = places.map((place) => `<option value="${esc(place)}"${line.storage === place ? " selected" : ""}>${esc(place)}</option>`).join("");
        return `<div class="field">
            <label for="parts-store-${index}">Taken from</label>
            <select class="${inputClass(key)}" id="parts-store-${index}" data-row="${index}" data-cell="storage">
                <option value="">${DASH}</option>${options}
            </select>
            ${note(key)}
        </div>`;
    }

    /* -------- editing */
    function currentParts() {
        const record = currentRecord();
        return record && kindOf(record) === KIND_PARTS ? record : null;
    }

    function onPartsEdit(target, isChange) {
        const record = currentParts();
        if (!record) return;
        if (target.hasAttribute("data-pick")) {
            // Typing searches; only a tap on the list chooses an item.
            if (!isChange) showPicker(target, target.value);
            return;
        }
        const parts = record.parts;
        let redraw = false;
        if (target.hasAttribute("data-head")) {
            // A select fires input before change, so the edit lands on the
            // first and the screen is redrawn on the second.
            const key = target.getAttribute("data-head");
            editHead(record, key, target.value);
            redraw = isChange && ["site_id", "trip_date", "visit_type"].indexOf(key) !== -1;
        } else if (target.hasAttribute("data-trip-unit")) {
            setMember(parts.units, target.getAttribute("data-trip-unit"), target.checked);
            parts.units = siteUnits(parts.site_id).map((unit) => String(unit.bq)).filter((bq) => parts.units.indexOf(bq) !== -1);
        } else if (target.hasAttribute("data-unit")) {
            const line = parts.lines[Number(target.getAttribute("data-row"))];
            if (line) setMember(line.units, target.getAttribute("data-unit"), target.checked);
            refreshTotal(parts, Number(target.getAttribute("data-row")));
        } else if (target.hasAttribute("data-cell")) {
            editCell(parts, target, isChange);
        } else {
            return;
        }
        touch(record);
        if (redraw) render();
    }

    function setMember(list, value, present) {
        const at = list.indexOf(value);
        if (present && at === -1) list.push(value);
        if (!present && at !== -1) list.splice(at, 1);
    }

    /** A new site starts the trip again: its units and lines belonged to the
        old one. The date and the visit type re-apply the rule to every line
        nobody has overruled. */
    function editHead(record, key, value) {
        const parts = record.parts;
        if (key === "site_id") {
            if (String(parts.site_id) === String(value)) return;
            parts.site_id = value;
            parts.units = [];
            parts.lines = [];
            parts.kitted = [];
            parts.prefilled = false;
            parts.visit_type = startingVisitType(parts);
            record.label = siteLabel(findSite(value));
            return;
        }
        parts[key] = value;
        if (key === "trip_date" || key === "visit_type") applyRules(parts);
    }

    function editCell(parts, target, isChange) {
        const index = Number(target.getAttribute("data-row"));
        const line = parts.lines[index];
        if (!line) return;
        const cell = target.getAttribute("data-cell");
        if (cell === "invoice") {
            line.invoice = target.value;
            line.manual = target.value !== ruleFor(parts, line.kind).invoice;
            refreshRow(parts, index);
            return;
        }
        line[cell] = target.value;
        if (cell === "quantity") refreshTotal(parts, index);
    }

    function refreshTotal(parts, index) {
        const hint = document.querySelector(`[data-total="${index}"]`);
        if (hint && parts.lines[index]) hint.textContent = totalHint(parts, parts.lines[index]);
    }

    function refreshRow(parts, index) {
        const row = document.getElementById(`parts-row-${index}`);
        if (row && parts.lines[index]) row.outerHTML = partsRow(parts, parts.lines[index], index);
    }

    function addRow(kind) {
        const record = currentParts();
        if (!record || !KIND_LABEL[kind]) return;
        const parts = record.parts;
        if (parts.lines.length >= state.pack.parts_sheet.lines.length) return;
        parts.lines.push(newLine(parts, kind, "", kind === LINE_VISIT ? "1" : "", []));
        touch(record);
        render();
        const input = document.getElementById(`parts-pick-${parts.lines.length - 1}`);
        if (input) {
            input.scrollIntoView({ block: "center" });
            input.focus();
        }
    }

    /** Removing a line moves every line after it up a row, so the messages
        about rows no longer fit and are cleared. */
    function removeRow(index) {
        const record = currentParts();
        if (!record || !record.parts.lines[index]) return;
        record.parts.lines.splice(index, 1);
        state.errors = {};
        touch(record);
        render();
    }

    function allUnits(index) {
        const record = currentParts();
        const line = record ? record.parts.lines[index] : null;
        if (!line) return;
        line.units = record.parts.units.slice();
        touch(record);
        refreshRow(record.parts, index);
    }

    function toStart() {
        const record = currentParts();
        if (!record) return;
        record.parts.step = "start";
        state.errors = {};
        touch(record);
        render();
        window.scrollTo(0, 0);
    }

    function toLines() {
        const record = currentParts();
        if (!record) return;
        state.errors = tripErrors(record.parts);
        if (!Object.keys(state.errors).length) {
            fitLinesToUnits(record.parts);
            record.parts.step = "lines";
        }
        touch(record);
        render();
        window.scrollTo(0, 0);
    }

    function submitParts() {
        const record = currentParts();
        if (record && record.parts.step === "lines") finishParts();
        else toLines();
    }

    /* -------- validation: the platform's messages, word for word */
    function tripErrors(parts) {
        const errors = {};
        const types = state.pack.billing.visit_types || {};
        if (!parts.site_id) errors[headerName("site_id")] = "Site is required.";
        else if (!findSite(parts.site_id)) errors[headerName("site_id")] = "That site is not in the platform. Choose one from the list.";
        checkTripDate(asText(parts.trip_date).trim(), errors);
        if (!parts.visit_type) errors[headerName("visit_type")] = "Visit type is required.";
        else if (!Object.prototype.hasOwnProperty.call(types, parts.visit_type)) errors[headerName("visit_type")] = "Choose a visit type from the list.";
        if (!parts.technician_id) errors[headerName("technician_id")] = "Technician is required.";
        else if (!findTechnician(parts.technician_id)) errors[headerName("technician_id")] = "That technician is not in the platform. Choose one from the list.";
        if (!parts.units.length) errors[headerName("units")] = "Tick the units serviced on this trip.";
        checkLength(headerName("notes"), asText(parts.notes).trim(), PARTS_NOTES_MAX, errors);
        return errors;
    }

    function checkTripDate(value, errors) {
        const key = headerName("trip_date");
        if (!value) errors[key] = "Trip date is required.";
        else if (!isIsoDate(value)) errors[key] = "Use the date format YYYY-MM-DD, or leave it blank.";
        else if (value > todayIso()) errors[key] = "Parts cannot be used on a trip that has not happened yet.";
    }

    function lineErrors(parts, line, index, errors) {
        const names = rowNames(index);
        const item = findItem(line.number);
        if (!asText(line.number).trim()) errors[names.number] = "Choose an item, or clear this row.";
        else if (!item) errors[names.number] = "That item is not in the parts list. Choose one from the list.";
        else if (item.kind !== line.kind) errors[names.number] = `That is not a ${asText(KIND_LABEL[line.kind]).toLowerCase()} item. Choose one from this line's list.`;
        if (!asText(line.quantity).trim()) errors[names.quantity] = "Quantity is required.";
        else if (quantityNumber(line.quantity) === null) errors[names.quantity] = "Give a quantity above zero, with at most two decimals - 1, 1.5 or 1,5.";
        if (!isTripKind(line.kind) && !lineUnits(parts, line).length) errors[names.units] = "Choose the units this went into.";
        if (line.invoice !== "yes" && line.invoice !== "no") errors[names.invoice] = "Say whether this line is invoiced - yes or no.";
        const places = state.pack.parts.storage_locations || [];
        if (line.storage && places.indexOf(line.storage) === -1) errors[names.storage] = "Choose a storage location from the list, or leave it blank.";
    }

    function validateParts(parts) {
        const errors = tripErrors(parts);
        const filled = parts.lines.filter(isFilled);
        parts.lines.forEach((line, index) => { if (isFilled(line)) lineErrors(parts, line, index, errors); });
        if (!filled.length) errors[rowNames(0).number] = "Add at least one line - the visit, at least.";
        return errors;
    }

    function finishParts() {
        const record = currentParts();
        if (!record || !packCovers(record)) return;
        const parts = record.parts;
        state.errors = validateParts(parts);
        if (Object.keys(state.errors).length) {
            if (Object.keys(tripErrors(parts)).length) parts.step = "start";
            touch(record);
            render();
            return;
        }
        record.status = "finished";
        record.sheet = buildPartsSheet(record);
        touch(record);
        go(`#finished/${encodeURIComponent(record.id)}`);
    }

    /* -------- the outputs */

    /** The report data file: every header field and every one of the pack's
        rows present, blank or not, and every value a string. A line's units
        are the BQ serials, space-separated - a serial never holds a space. */
    function buildPartsReport(record) {
        const parts = record.parts;
        const sheet = state.pack.parts_sheet;
        const head = { site_id: parts.site_id, trip_date: parts.trip_date, visit_type: parts.visit_type,
            technician_id: parts.technician_id, units: parts.units.join(" "), notes: parts.notes };
        const fields = {};
        Object.keys(sheet.header).forEach((key) => { fields[asText(sheet.header[key])] = asText(head[key]).trim(); });
        sheet.lines.forEach((names, index) => {
            const line = parts.lines[index];
            const values = line && isFilled(line) ? rowValues(parts, line) : {};
            Object.keys(names).forEach((part) => { fields[asText(names[part])] = asText(values[part]).trim(); });
        });
        return {
            format: REPORT_FORMAT,
            version: FORMAT_VERSION,
            kind: KIND_PARTS,
            site_id: asText(parts.site_id),
            made_at: nowIso(),
            parts_version: asText(state.pack.parts.version),
            billing_version: asText(state.pack.billing.version),
            pack_made_on: asText(state.pack.made_on),
            fields: fields,
        };
    }

    function rowValues(parts, line) {
        return { number: line.number, quantity: line.quantity, units: lineUnits(parts, line).join(" "),
            invoice: line.invoice, storage: line.storage };
    }

    /** The logistics sheet, frozen at Finish like the other reports. */
    function buildPartsSheet(record) {
        const parts = record.parts;
        const site = findSite(parts.site_id) || {};
        const tech = findTechnician(parts.technician_id) || {};
        const agreement = agreementOn(site, parts.trip_date);
        return {
            kind: KIND_PARTS,
            customer: orDash(site.customer),
            site: orDash(site.label),
            trip_date: niceDate(parts.trip_date),
            visit_type: orDash(visitTypeLabel(parts.visit_type)),
            technician: orDash(asText(tech.initials) || asText(tech.name)),
            agreement: agreement.expired
                ? `Expired ${niceDate(agreement.expires)} - none`
                : (AGREEMENT_LABEL[agreement.kind] || agreement.kind),
            units: parts.units.map(unitLabel),
            rows: parts.lines.filter(isFilled).map((line) => sheetRow(parts, line)),
            notes: asText(parts.notes).split(/\r?\n/).map((text) => text.trim()).filter(Boolean),
            billing_version: orDash(asText(state.pack.billing.version)),
            parts_version: orDash(asText(state.pack.parts.version)),
            provisional: !state.pack.billing.confirmed,
        };
    }

    function sheetRow(parts, line) {
        const item = findItem(line.number) || {};
        const trip = isTripKind(line.kind);
        const quantity = asText(line.quantity).trim().replace(",", ".");
        return {
            kind: KIND_LABEL[line.kind] || line.kind,
            number: asText(line.number).trim(),
            description: orDash(item.description),
            per_unit: trip ? DASH : quantity,
            units: trip ? "Whole trip" : lineUnits(parts, line).map(unitLabel).join(", "),
            total: totalQuantity(parts, line) || quantity,
            invoice: answerLabel(line.invoice),
            overruled: isOverruled(parts, line),
            storage: orDash(line.storage),
        };
    }

    function partsSheetMarkup(sheet) {
        const info = [["Customer", sheet.customer], ["Site", sheet.site], ["Date", sheet.trip_date],
            ["Visit type", sheet.visit_type], ["Technician", sheet.technician], ["Agreement", sheet.agreement]];
        const body = sheet.rows.map((row) => `<tr>
                <td>${esc(row.kind)}</td><td class="mono">${esc(row.number)}</td><td>${esc(row.description)}</td>
                <td class="num">${esc(row.per_unit)}</td><td>${esc(row.units)}</td><td class="num"><strong>${esc(row.total)}</strong></td>
                <td class="result">${esc(row.invoice)}${row.overruled ? " ∗" : ""}</td><td>${esc(row.storage)}</td>
            </tr>`).join("");
        const overruled = sheet.rows.some((row) => row.overruled);
        return `<article class="report-sheet field-sheet parts-sheet">
            <header class="report-head">
                <span class="brand-text">BactiQuant</span>
                <div class="title"><h1>Parts used</h1><div>${esc(sheet.site)} · ${esc(sheet.trip_date)}</div></div>
            </header>
            <section class="report-info">${info.map(([label, value]) => `<div><b>${esc(label)}</b>${esc(value)}</div>`).join("")}</section>
            <section class="report-section">
                <h2>Units serviced (${esc(sheet.units.length)})</h2>
                <p>${esc(sheet.units.join(", "))}</p>
            </section>
            <section class="report-section">
                <h2>Lines</h2>
                <table class="report-table">
                    <thead><tr><th>Type</th><th>Item no.</th><th>Description</th><th>Qty per unit</th><th>Units</th><th>Total</th><th>Invoice</th><th>Storage</th></tr></thead>
                    <tbody>${body}</tbody>
                </table>
                ${overruled ? `<p class="parts-foot">∗ Overruled by the technician - the billing rule said otherwise.</p>` : ""}
            </section>
            <section class="report-section">
                <h2>Notes</h2>
                ${sheet.notes.length ? sheet.notes.map((text) => `<p>${esc(text)}</p>`).join("") : "<p>None.</p>"}
            </section>
            <footer class="report-foot">
                <span>Billing rules ${esc(sheet.billing_version)}${sheet.provisional ? " (provisional)" : ""} · parts list ${esc(sheet.parts_version)}</span>
            </footer>
        </article>`;
    }

    /* ---------------------------------------------------------------- Reports screen */
    function renderReports() {
        const records = state.reports.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        const body = records.length
            ? `<div class="table-wrap"><table class="table responsive field-reports">
                <thead><tr><th>Unit or site</th><th>Report</th><th>Date</th><th>Status</th><th>Last changed</th><th></th></tr></thead>
                <tbody>${records.map(reportRow).join("")}</tbody>
            </table></div>`
            : `<p>No reports on this iPad yet. Start one from <a href="#units">Units</a>.</p>`;
        return `<main class="shell">
            ${banners()}
            ${pageHead("On this iPad", "Reports", `${records.length} report${records.length === 1 ? "" : "s"}`)}
            ${body}
        </main>`;
    }

    function reportRow(record) {
        const kind = kindOf(record);
        const dateKey = kind === KIND_INSTALLATION ? "installed_on" : "event_date";
        let date = record.values ? niceDate(asText(record.values[dateKey])) : DASH;
        if (kind === KIND_PARTS) date = record.parts ? niceDate(asText(record.parts.trip_date)) : DASH;
        const id = esc(record.id);
        const actions = state.confirmDelete === record.id ? deleteConfirm(record) : `
            <button class="btn btn-secondary" type="button" data-action="open-report" data-id="${id}">Open</button>
            <button class="btn btn-ghost" type="button" data-action="ask-delete" data-id="${id}">Delete</button>`;
        return `<tr>
            <td data-th="Unit or site"><strong>${esc(record.label)}</strong></td>
            <td data-th="Report">${esc(KIND_TITLE[kind])}</td>
            <td data-th="Date">${esc(date)}</td>
            <td data-th="Status">${badge(record.status)}</td>
            <td data-th="Last changed">${esc(niceStamp(record.updated_at))}</td>
            <td data-th=""><div class="field-actions">${actions}</div></td>
        </tr>`;
    }

    function deleteConfirm(record) {
        const warning = record.status === "finished" ? " It has not been marked as sent." : "";
        const id = esc(record.id);
        return `<span class="error">Delete this report? This cannot be undone.${esc(warning)}</span>
            <button class="btn btn-primary field-danger" type="button" data-action="confirm-delete" data-id="${id}">Delete</button>
            <button class="btn btn-ghost" type="button" data-action="cancel-delete">Keep it</button>`;
    }

    function openReport(id) {
        const record = findRecord(id);
        if (!record) return;
        state.errors = {};
        go(record.status === "draft" ? `#report/${encodeURIComponent(id)}` : `#finished/${encodeURIComponent(id)}`);
    }

    function deleteReport(id) {
        state.reports = state.reports.filter((record) => record.id !== id);
        state.confirmDelete = "";
        saveReports();
        showFlash("Report deleted.");
    }

    /* ---------------------------------------------------------------- events */
    const ACTIONS = {
        "open-unit": (el) => openUnit(el.getAttribute("data-bq"), false),
        "open-unplanned": (el) => openUnit(el.getAttribute("data-bq"), true),
        "open-installation": (el) => openInstallation(el.getAttribute("data-bq")),
        "open-report": (el) => openReport(el.getAttribute("data-id")),
        "ask-delete": (el) => { state.confirmDelete = el.getAttribute("data-id"); render(); },
        "cancel-delete": () => { state.confirmDelete = ""; render(); },
        "confirm-delete": (el) => deleteReport(el.getAttribute("data-id")),
        "print": () => window.print(),
        "save-file": () => { saveDataFile(); },
        "mark-sent": markSent,
        "edit": editRecord,
        "new-parts": newParts,
        "parts-start": toStart,
        "add-row": (el) => addRow(el.getAttribute("data-kind")),
        "remove-row": (el) => removeRow(Number(el.getAttribute("data-row"))),
        "row-all": (el) => allUnits(Number(el.getAttribute("data-row"))),
        "pick-item": pickItem,
    };

    function onClick(event) {
        if (!event.target.closest(".parts-pick")) closePickers();
        const el = event.target.closest("[data-action]");
        if (!el) return;
        const action = ACTIONS[el.getAttribute("data-action")];
        if (action) {
            event.preventDefault();
            action(el);
        }
    }

    function onInput(event) {
        const target = event.target;
        if (target.id === "unit-search") {
            state.unitQuery = target.value;
            applyUnitFilter();
        } else if (target.closest("#report-form")) {
            onFormEdit(target, false);
        } else if (target.closest("#parts-form")) {
            onPartsEdit(target, false);
        }
    }

    function onChange(event) {
        const target = event.target;
        if (target.id === "pack-file") {
            if (target.files && target.files[0]) readPackFile(target.files[0]);
        } else if (target.closest("#report-form")) {
            onFormEdit(target, true);
        } else if (target.closest("#parts-form")) {
            onPartsEdit(target, true);
        }
    }

    function onSubmit(event) {
        if (event.target.id === "parts-form") {
            event.preventDefault();
            // Return in an item search box means "search", never "finish the sheet".
            const active = document.activeElement;
            if (active && active.hasAttribute && active.hasAttribute("data-pick")) return;
            submitParts();
            return;
        }
        if (event.target.id !== "report-form") return;
        event.preventDefault();
        finish();
    }

    function onRoute() {
        state.confirmDelete = "";
        if (route().name !== "report") state.errors = {};
        render();
        window.scrollTo(0, 0);
    }

    function start() {
        loadState();
        const app = document.getElementById("app");
        app.addEventListener("click", onClick);
        app.addEventListener("input", onInput);
        app.addEventListener("change", onChange);
        app.addEventListener("submit", onSubmit);
        app.addEventListener("focusin", onFocusIn);
        window.addEventListener("hashchange", onRoute);
        if (!window.location.hash) {
            window.location.replace(state.pack ? "#units" : "#pack");
        }
        render();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
