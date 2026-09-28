/**
 * CLEAR Events RFP — Pages Function version
 * Runs as part of the events-site Pages project itself, reachable at
 * events-site-68h.pages.dev/api/... (or events.clear-hq.org/api/... once
 * the custom domain is usable again — this same file serves both, no
 * changes needed). Genuinely same-origin with the form page, so no
 * cross-site cookie issues, and it shares the SAME RFP_DATA KV
 * namespace as the standalone Worker — same data either way.
 *
 * File location in the repo: functions/api/[[path]].js
 */

// ---- Staff directory: email -> display name ----
// Multiple emails can map to the same person.
const STAFF_DIRECTORY = {
  "cgomez@clearhq.org": "Candela Gomez",
  "candela@thenrwc.org": "Candela Gomez",
  "candela.gomez@nasasps.org": "Candela Gomez",
  "mgrayson@clearhq.org": "Matt Grayson",
  "mgrayson@aascb.org": "Matt Grayson",
  "matt.grayson@nasasps.org": "Matt Grayson",
  "avance@clearhq.org": "Amanda Vance",
  "zgriffin@clearhq.org": "Zephir Griffin",
  "jmarkey@clearhq.org": "Jodie Markey",
  "aparfitt@clearhq.org": "Adam Parfitt",
  "jason@thenrwc.org": "Jason Whyte"
};

// Admin-level access (delete records, manage staff list, override locks, etc.)
const ADMIN_EMAILS = [
  "avance@clearhq.org"
];

// Planner-level access (currently just Candela) — allowed to change an
// RFP's status (draft/open/closed/awarded) in addition to admins.
const PLANNER_EMAILS = [
  "cgomez@clearhq.org",
  "candela@thenrwc.org",
  "candela.gomez@nasasps.org"
];

// This Worker is bound as a ROUTE on portal.clear-hq.org/api/* (same
// domain as the form itself), not a separate custom domain. That means
// every request here is same-origin from the form's point of view —
// no CORS, no preflight, no separate login. Access already authenticated
// the whole domain before the page (or this route) ever loaded.

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ---------------- Identity ----------------

// Cloudflare Access injects this header once a request has passed the
// login wall. If it's missing, either the request didn't come through
// Access, or Access isn't correctly configured in front of this Worker.
function getIdentity(request) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const name = STAFF_DIRECTORY[normalizedEmail] || normalizedEmail;
  const isAdmin = ADMIN_EMAILS.includes(normalizedEmail);
  const isPlanner = PLANNER_EMAILS.includes(normalizedEmail);

  return { email: normalizedEmail, name, isAdmin, isPlanner };
}

// ---------------- ID generator ----------------

function generateId() {
  return "rfp_" + crypto.randomUUID().split("-")[0];
}

// ---------------- Public slugs ----------------
// Human-readable URL for a public RFP page, e.g. "nasasps-2027-annual-conference".
// Generated once, the first time a record is set to "open", and kept
// stable after that even if the event name is edited later.
function slugify(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function generateUniqueSlug(env, acronym, eventName) {
  const base = slugify(`${acronym || ""}-${eventName || ""}`) || "rfp";
  let slug = base;
  let counter = 2;
  while (await env.RFP_DATA.get(`slug:${slug}`)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  return slug;
}

// Explicit allow-list of fields shown on public pages. New internal-only
// fields (like the budget numbers) are private by default unless added
// here on purpose.
function publicRfpDetail(record) {
  const d = record.data || {};
  return {
    groupName: d.groupName || "",
    eventName: d.eventName || "",
    acronym: d.acronym || "",
    websiteLink: d.websiteLink || "",
    logoUrl: d.logoDataUrl || d.logoUrl || "",
    eventLogoUrl: d.eventLogoDataUrl || "",
    rfpDueDate: d.rfpDueDate || "",
    sectionPriorities: d.sectionPriorities || [],
    cities: d.cities || [],
    dates: d.dates || [],
    patternFlexible: !!d.patternFlexible,
    noFriday: !!d.noFriday,
    patternNotes: d.patternNotes || "",
    attendanceType: d.attendanceType || "",
    attendanceMin: d.attendanceMin || "",
    attendanceMax: d.attendanceMax || "",
    attendanceScope: d.attendanceScope || "",
    guestRooms: d.guestRooms || [],
    colocation: d.colocation || "",
    meetingSpace: d.meetingSpace || [],
    concessions: d.concessions || [],
    fnb: d.fnb || [],
    siteInspection: d.siteInspection || "",
    exhibits: d.exhibits || {}
  };
}

function publicRfpSummary(record) {
  const d = record.data || {};
  return {
    slug: record.publicSlug,
    groupName: d.groupName || "",
    eventName: d.eventName || "",
    acronym: d.acronym || "",
    logoUrl: d.logoDataUrl || d.logoUrl || "",
    eventLogoUrl: d.eventLogoDataUrl || "",
    rfpDueDate: d.rfpDueDate || "",
    dates: d.dates || []
  };
}

// ---------------- Main handler ----------------

export async function onRequest(context) {
  const { request, env } = context;
  {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---- Public routes (no Access identity required) ----
    // These only ever return records with status "open", and only the
    // fields in publicRfpDetail/publicRfpSummary above.
    if (path === "/api/public/rfps" && method === "GET") {
      const list = await env.RFP_DATA.list({ prefix: "rfp:" });
      const records = await Promise.all(
        list.keys.map(async (k) => {
          const raw = await env.RFP_DATA.get(k.name);
          if (!raw) return null;
          const record = JSON.parse(raw);
          if (record.status !== "open" || !record.publicSlug) return null;
          return publicRfpSummary(record);
        })
      );
      return jsonResponse(records.filter(Boolean));
    }

    const publicSingleMatch = path.match(/^\/api\/public\/rfps\/([^/]+)$/);
    if (publicSingleMatch && method === "GET") {
      const slug = publicSingleMatch[1];
      const id = await env.RFP_DATA.get(`slug:${slug}`);
      if (!id) return errorResponse("Not found", 404);
      const raw = await env.RFP_DATA.get(`rfp:${id}`);
      if (!raw) return errorResponse("Not found", 404);
      const record = JSON.parse(raw);
      if (record.status !== "open") return errorResponse("Not found", 404);
      return jsonResponse(publicRfpDetail(record));
    }

    // ---- Everything below this line requires staff login ----
    const identity = getIdentity(request);
    if (!identity) {
      return errorResponse("Not authenticated. Access identity header missing.", 401);
    }

    // ---- GET /api/whoami ----
    // Frontend calls this on load to know who's logged in and whether
    // they have admin rights, without needing its own login step.
    if (path === "/api/whoami" && method === "GET") {
      return jsonResponse(identity);
    }

    // ---- GET /api/rfps ----
    // Summary list for a dashboard/listing view (not full version history).
    if (path === "/api/rfps" && method === "GET") {
      const list = await env.RFP_DATA.list({ prefix: "rfp:" });
      const records = await Promise.all(
        list.keys.map(async (k) => {
          const raw = await env.RFP_DATA.get(k.name);
          if (!raw) return null;
          const record = JSON.parse(raw);
          return {
            id: record.id,
            status: record.status,
            currentVersion: record.currentVersion,
            groupName: record.data?.groupName || "(untitled)",
            eventName: record.data?.eventName || "",
            updatedAt: record.updatedAt
          };
        })
      );
      return jsonResponse(records.filter(Boolean));
    }

    const singleMatch = path.match(/^\/api\/rfps\/([^/]+)$/);

    // ---- GET /api/rfps/:id ----
    // Full record: current data, complete version history, notes.
    if (singleMatch && method === "GET") {
      const id = singleMatch[1];
      const raw = await env.RFP_DATA.get(`rfp:${id}`);
      if (!raw) return errorResponse("Not found", 404);
      return jsonResponse(JSON.parse(raw));
    }

    // ---- POST /api/rfps ----
    // Create a new RFP record. Body = the intake form field data.
    if (path === "/api/rfps" && method === "POST") {
      const body = await request.json();
      const id = generateId();
      const now = new Date().toISOString();

      const record = {
        id,
        status: "draft",
        currentVersion: 1,
        data: body,
        updatedAt: now,
        versions: [
          {
            version: 1,
            savedBy: identity.name,
            savedByEmail: identity.email,
            savedAt: now,
            data: body
          }
        ],
        notes: []
      };

      await env.RFP_DATA.put(`rfp:${id}`, JSON.stringify(record));
      return jsonResponse(record, 201);
    }

    // ---- PUT /api/rfps/:id ----
    // Update an existing record. Always appends a new version rather
    // than overwriting history, so old snapshots stay intact.
    if (singleMatch && method === "PUT") {
      const id = singleMatch[1];
      const raw = await env.RFP_DATA.get(`rfp:${id}`);
      if (!raw) return errorResponse("Not found", 404);

      const record = JSON.parse(raw);
      const body = await request.json();
      const now = new Date().toISOString();
      const newVersion = record.currentVersion + 1;

      record.data = body;
      record.currentVersion = newVersion;
      record.updatedAt = now;
      record.versions.push({
        version: newVersion,
        savedBy: identity.name,
        savedByEmail: identity.email,
        savedAt: now,
        data: body
      });

      await env.RFP_DATA.put(`rfp:${id}`, JSON.stringify(record));
      return jsonResponse(record);
    }

    // ---- DELETE /api/rfps/:id ----
    // Admin-only. Staff who aren't on ADMIN_EMAILS get a 403.
    if (singleMatch && method === "DELETE") {
      if (!identity.isAdmin) {
        return errorResponse("Admin access required", 403);
      }
      const id = singleMatch[1];
      await env.RFP_DATA.delete(`rfp:${id}`);
      return jsonResponse({ deleted: id });
    }

    // ---- POST /api/rfps/:id/notes ----
    // Appends a note (user, timestamp, comment). Never edits or removes
    // prior notes, so it reads as a running history.
    const notesMatch = path.match(/^\/api\/rfps\/([^/]+)\/notes$/);
    if (notesMatch && method === "POST") {
      const id = notesMatch[1];
      const raw = await env.RFP_DATA.get(`rfp:${id}`);
      if (!raw) return errorResponse("Not found", 404);

      const record = JSON.parse(raw);
      const body = await request.json();

      if (!body.comment || !body.comment.trim()) {
        return errorResponse("Note comment cannot be empty", 400);
      }

      record.notes.push({
        user: identity.name,
        userEmail: identity.email,
        timestamp: new Date().toISOString(),
        comment: body.comment.trim()
      });

      await env.RFP_DATA.put(`rfp:${id}`, JSON.stringify(record));
      return jsonResponse(record);
    }

    // ---- PUT /api/rfps/:id/status ----
    // Moves a record through draft -> open -> closed -> awarded.
    // Restricted to admins and planners (Candela) — everyone else can
    // see status but not change it.
    const statusMatch = path.match(/^\/api\/rfps\/([^/]+)\/status$/);
    if (statusMatch && method === "PUT") {
      if (!identity.isAdmin && !identity.isPlanner) {
        return errorResponse("Only admins or the event planner can change status", 403);
      }
      const id = statusMatch[1];
      const raw = await env.RFP_DATA.get(`rfp:${id}`);
      if (!raw) return errorResponse("Not found", 404);

      const record = JSON.parse(raw);
      const body = await request.json();
      const validStatuses = ["draft", "open", "closed", "awarded"];

      if (!validStatuses.includes(body.status)) {
        return errorResponse(`Status must be one of: ${validStatuses.join(", ")}`, 400);
      }

      record.status = body.status;
      record.updatedAt = new Date().toISOString();

      // First time this record goes "open", mint a permanent human-readable
      // slug and index it so the public page can be found by that slug.
      // Closing/reopening later reuses the same slug and link.
      if (body.status === "open" && !record.publicSlug) {
        record.publicSlug = await generateUniqueSlug(env, record.data?.acronym, record.data?.eventName);
        await env.RFP_DATA.put(`slug:${record.publicSlug}`, id);
      }

      await env.RFP_DATA.put(`rfp:${id}`, JSON.stringify(record));
      return jsonResponse(record);
    }

    return errorResponse("Not found", 404);
  }
}
