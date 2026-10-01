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

// Staff whose email domain ties them to one specific organization only
// see and manage that organization's RFPs and proposals — e.g. Jason
// Whyte (jason@thenrwc.org) is scoped to NRWC only. Admins and the
// planner are exempt regardless of which email domain they log in
// with, since they need full cross-org access by design.
const DOMAIN_ORG_RESTRICTIONS = {
  "thenrwc.org": "NRWC"
};

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
  const domain = normalizedEmail.split("@")[1] || "";
  const orgRestriction = (!isAdmin && !isPlanner && DOMAIN_ORG_RESTRICTIONS[domain]) || null;

  return { email: normalizedEmail, name, isAdmin, isPlanner, orgRestriction };
}

// ---------------- Candela notification email ----------------

// Set as a Cloudflare Pages environment variable (Secret) named
// POWER_AUTOMATE_WEBHOOK_URL — the "HTTP POST URL" from the Power
// Automate flow's trigger. The flow itself builds the email subject and
// body from the eventName/groupName fields posted here, so this code
// only needs to send those two values.

// Fire-and-forget: a failed or misconfigured webhook must never block a
// staff member from actually saving their work. Any error here is
// logged (visible in the Cloudflare Pages Functions log) and swallowed.
async function notifyCandela(env, { eventName, groupName }) {
  if (!env.POWER_AUTOMATE_WEBHOOK_URL) {
    console.error("notifyCandela: POWER_AUTOMATE_WEBHOOK_URL is not set, skipping notification");
    return;
  }
  const eventLabel = eventName || "(untitled event)";
  const groupLabel = groupName || "(no group set)";
  try {
    const res = await fetch(env.POWER_AUTOMATE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName: eventLabel, groupName: groupLabel })
    });
    if (!res.ok) {
      console.error("notifyCandela: Power Automate webhook returned", res.status, await res.text());
    }
  } catch (err) {
    console.error("notifyCandela: failed to call webhook", err);
  }
}

// ---------------- ID generator ----------------

function generateId() {
  return "rfp_" + crypto.randomUUID().split("-")[0];
}

function generateProposalId() {
  return "prop_" + crypto.randomUUID().split("-")[0];
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

// The date venues actually need to hit is earlier than the planner's own
// internal deadline (the "RFP Response Report Due Date") — she needs
// buffer time to compile responses before her own report is due. Public
// pages always show this computed date, never the internal one.
function computeProposalDueDate(rfpDueDate) {
  if (!rfpDueDate) return "";
  const d = new Date(rfpDueDate + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() - 14);
  return d.toISOString().slice(0, 10);
}

// Peak Nights is the highest room count across all listed nights — the
// headline number venues actually need to judge fit on, derived here
// rather than trusting a separately-entered value to stay in sync.
function computePeakNights(guestRooms) {
  const counts = (guestRooms || []).map(g => Number(g.rooms) || 0);
  return counts.length ? Math.max(...counts) : 0;
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
    proposalDueDate: computeProposalDueDate(d.rfpDueDate),
    sectionPriorities: d.sectionPriorities || [],
    cities: d.cities || [],
    dates: d.dates || [],
    patternFlexible: !!d.patternFlexible,
    noFriday: !!d.noFriday,
    patternNotes: d.patternNotes || "",
    maxAttendance: d.maxAttendance || "",
    attendanceByDay: d.attendanceByDay || [],
    guestRooms: d.guestRooms || [],
    maxNightlyRoomRate: d.maxNightlyRoomRate || "",
    peakNights: computePeakNights(d.guestRooms),
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
    proposalDueDate: computeProposalDueDate(d.rfpDueDate),
    dates: d.dates || [],
    cities: d.cities || [],
    maxAttendance: d.maxAttendance || "",
    peakNights: computePeakNights(d.guestRooms)
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
      if (!id) return errorResponse(`No record indexed under slug "${slug}" (slug->id lookup failed)`, 404);
      const raw = await env.RFP_DATA.get(`rfp:${id}`);
      if (!raw) return errorResponse(`Slug "${slug}" points at id "${id}", but no record exists with that id`, 404);
      const record = JSON.parse(raw);
      if (record.status !== "open") return errorResponse(`Record found for slug "${slug}", but its status is "${record.status}", not "open"`, 404);
      return jsonResponse(publicRfpDetail(record));
    }

    // ---- POST /api/public/rfps/:slug/proposals ----
    // A venue submitting a proposal response. Public, no login — anyone
    // with the link can submit while the RFP is open. Each submission is
    // stored as its own KV entry (not nested inside the RFP record) so a
    // large number of proposals never bloats the RFP's own record, and so
    // staff can list/filter proposals independently of any one RFP.
    const publicProposalMatch = path.match(/^\/api\/public\/rfps\/([^/]+)\/proposals$/);
    if (publicProposalMatch && method === "POST") {
      const slug = publicProposalMatch[1];
      const rfpId = await env.RFP_DATA.get(`slug:${slug}`);
      if (!rfpId) return errorResponse("This RFP could not be found.", 404);
      const raw = await env.RFP_DATA.get(`rfp:${rfpId}`);
      if (!raw) return errorResponse("This RFP could not be found.", 404);
      const rfpRecord = JSON.parse(raw);
      if (rfpRecord.status !== "open") {
        return errorResponse("This RFP is not currently accepting proposals.", 409);
      }

      const body = await request.json();

      // Required-field validation, mirroring what the form enforces
      // client-side — never trust the client alone for this.
      const requiredFields = [
        ["propertyName", "Property name"],
        ["streetAddress", "Street address"],
        ["city", "City"],
        ["stateProvince", "State/Province"],
        ["zipCode", "Zip/Postal code"],
        ["phone", "Phone number"],
        ["website", "Website"],
        ["contactName", "Sales contact name"],
        ["contactPhone", "Sales contact phone number"],
        ["contactEmail", "Sales contact email address"],
        ["guestRoomRate", "Guest room rate"],
        ["fnbMinimum", "Food & Beverage minimum"],
        ["meetingRoomRentalFee", "Meeting room rental fee"],
        ["cumulativeAttritionPercent", "Cumulative attrition %"],
        ["fnbGuaranteeOffered", "Whether an F&B guarantee is offered"],
        ["propertyType", "Property type"]
      ];
      for (const [key, label] of requiredFields) {
        if (!body[key] || !String(body[key]).trim()) {
          return errorResponse(`${label} is required.`, 400);
        }
      }
      if (body.fnbGuaranteeOffered === "yes") {
        const fnbRequired = [
          ["fnbGuaranteeAttendeeCount", "F&B guarantee attendee count"],
          ["fnbGuaranteeDays", "F&B guarantee number of days"],
          ["fnbGuaranteeAmount", "F&B guarantee total proposed amount"],
          ["fnbGuaranteeInclusive", "Whether the F&B amount is inclusive or exclusive"]
        ];
        for (const [key, label] of fnbRequired) {
          if (!body[key] || !String(body[key]).trim()) {
            return errorResponse(`${label} is required when offering an F&B guarantee.`, 400);
          }
        }
        if (body.fnbGuaranteeInclusive === "exclusive") {
          if (!body.fnbGuaranteeTaxRate || !body.fnbGuaranteeServiceChargeRate) {
            return errorResponse("Tax rate(s) and service charge rate(s) are required when the F&B amount is exclusive.", 400);
          }
        }
      }
      if (!body.termsConfirmed) {
        return errorResponse("You must confirm that the terms and pricing will remain valid for 30 days after the proposal response deadline.", 400);
      }

      const proposalId = generateProposalId();
      const proposal = {
        id: proposalId,
        rfpId,
        rfpSlug: slug,
        // Denormalized from the RFP at submission time so the cross-event
        // proposals view never has to join back to the RFP record just to
        // show which event/group a proposal was for.
        eventName: rfpRecord.data?.eventName || "",
        groupName: rfpRecord.data?.groupName || "",
        acronym: rfpRecord.data?.acronym || "",
        submittedAt: new Date().toISOString(),

        propertyName: (body.propertyName || "").trim(),
        streetAddress: body.streetAddress || "",
        city: body.city || "",
        stateProvince: body.stateProvince || "",
        zipCode: body.zipCode || "",
        phone: body.phone || "",
        website: body.website || "",
        contactName: body.contactName || "",
        contactPhone: body.contactPhone || "",
        contactEmail: (body.contactEmail || "").trim(),

        // Array positions into rfpDatesSnapshot below, not rank values —
        // ranks can tie or sit untouched, positions are always unambiguous.
        proposedDateIndexes: Array.isArray(body.proposedDateIndexes) ? body.proposedDateIndexes : [],
        rfpDatesSnapshot: rfpRecord.data?.dates || [],

        guestRoomRate: body.guestRoomRate || "",
        rateFees: {
          taxes: !!body.rateFees?.taxes,
          resortFee: !!body.rateFees?.resortFee,
          destinationFee: !!body.rateFees?.destinationFee,
          other: !!body.rateFees?.other,
          otherText: body.rateFees?.otherText || ""
        },
        commissionable: body.commissionable || "",
        commissionPercent: body.commissionPercent || "",

        fnbMinimum: body.fnbMinimum || "",
        meetingRoomRentalFee: body.meetingRoomRentalFee || "",
        cumulativeAttritionPercent: body.cumulativeAttritionPercent || "",

        // F&B guarantee: yes/no, then — only if yes — the madlib terms.
        fnbGuaranteeOffered: body.fnbGuaranteeOffered || "",
        fnbGuaranteeAttendeeCount: body.fnbGuaranteeAttendeeCount || "",
        fnbGuaranteeDays: body.fnbGuaranteeDays || "",
        fnbGuaranteeAmount: body.fnbGuaranteeAmount || "",
        fnbGuaranteeInclusive: body.fnbGuaranteeInclusive || "",
        fnbGuaranteeTaxRate: body.fnbGuaranteeTaxRate || "",
        fnbGuaranteeServiceChargeRate: body.fnbGuaranteeServiceChargeRate || "",
        fnbGuaranteeOtherFees: body.fnbGuaranteeOtherFees || "",

        concessions: body.concessions || "",

        meetingSpaceOneFloor: body.meetingSpaceOneFloor || "",
        meetingSpaceFloorsExplain: body.meetingSpaceFloorsExplain || "",
        exhibitsLocation: body.exhibitsLocation || "",
        exhibitsLocationOther: body.exhibitsLocationOther || "",

        // Property type & area characteristics — replaces the old
        // free-text "About the Area" field.
        propertyType: body.propertyType || "",
        propertyTypeOtherText: body.propertyTypeOtherText || "",
        areaCharacteristics: Array.isArray(body.areaCharacteristics) ? body.areaCharacteristics : [],
        areaCharacteristicsOtherText: body.areaCharacteristicsOtherText || "",
        walkabilityDescription: body.walkabilityDescription || "",

        proposalDocumentLink: body.proposalDocumentLink || "",
        floorPlanFnbAvLinks: body.floorPlanFnbAvLinks || "",
        cvbPromotions: body.cvbPromotions || "",
        siteInspectionSupport: body.siteInspectionSupport || "",
        additionalNotes: body.additionalNotes || "",
        termsConfirmed: !!body.termsConfirmed
      };

      await env.RFP_DATA.put(`proposal:${rfpId}:${proposalId}`, JSON.stringify(proposal));
      return jsonResponse(proposal, 201);
    }

    // ---- Everything below this line requires staff login ----
    const identity = getIdentity(request);
    if (!identity) {
      return errorResponse("Not authenticated. Access identity header missing.", 401);
    }

    // ---- GET /api/proposals[?rfpId=xxx] ----
    // Staff view of submitted proposals — either scoped to one RFP (the
    // "Responses" tab) or across every RFP (the cross-event proposals
    // page). Admins and the planner see everything; an org-restricted
    // user (e.g. an NRWC-domain staffer) can view too, but only ever
    // sees proposals for their own organization. Everyone else is
    // fully denied, not just blocked from editing.
    if (path === "/api/proposals" && method === "GET") {
      if (!identity.isAdmin && !identity.isPlanner && !identity.orgRestriction) {
        return errorResponse("Only admins or the event planner can view proposals", 403);
      }
      const rfpIdFilter = url.searchParams.get("rfpId");
      const prefix = rfpIdFilter ? `proposal:${rfpIdFilter}:` : "proposal:";
      const list = await env.RFP_DATA.list({ prefix });
      let proposals = await Promise.all(
        list.keys.map(async (k) => {
          const raw = await env.RFP_DATA.get(k.name);
          return raw ? JSON.parse(raw) : null;
        })
      );
      proposals = proposals.filter(Boolean);
      if (identity.orgRestriction) {
        proposals = proposals.filter(p => p.acronym === identity.orgRestriction);
      }
      return jsonResponse(proposals.filter(Boolean));
    }

    // ---- GET /api/whoami ----
    // Frontend calls this on load to know who's logged in and whether
    // they have admin rights, without needing its own login step.
    if (path === "/api/whoami" && method === "GET") {
      return jsonResponse(identity);
    }

    // ---- GET /api/rfps ----
    // Summary list for a dashboard/listing view (not full version history).
    // Sorted by the RFP's own due date (soonest first) — KV's natural
    // list order is essentially random (lexicographic by a random id),
    // which isn't useful for staff triaging what's coming up.
    if (path === "/api/rfps" && method === "GET") {
      const list = await env.RFP_DATA.list({ prefix: "rfp:" });
      const records = await Promise.all(
        list.keys.map(async (k) => {
          const raw = await env.RFP_DATA.get(k.name);
          if (!raw) return null;
          const record = JSON.parse(raw);
          if (identity.orgRestriction && record.data?.acronym !== identity.orgRestriction) return null;
          return {
            id: record.id,
            status: record.status,
            currentVersion: record.currentVersion,
            groupName: record.data?.groupName || "(untitled)",
            eventName: record.data?.eventName || "",
            rfpDueDate: record.data?.rfpDueDate || null,
            updatedAt: record.updatedAt
          };
        })
      );
      const filtered = records.filter(Boolean);
      filtered.sort((a, b) => {
        if (!a.rfpDueDate && !b.rfpDueDate) return 0;
        if (!a.rfpDueDate) return 1;
        if (!b.rfpDueDate) return -1;
        return a.rfpDueDate.localeCompare(b.rfpDueDate);
      });
      return jsonResponse(filtered);
    }

    const singleMatch = path.match(/^\/api\/rfps\/([^/]+)$/);

    // ---- GET /api/rfps/:id ----
    // Full record: current data, complete version history, notes.
    if (singleMatch && method === "GET") {
      const id = singleMatch[1];
      const raw = await env.RFP_DATA.get(`rfp:${id}`);
      if (!raw) return errorResponse("Not found", 404);
      const record = JSON.parse(raw);
      if (identity.orgRestriction && record.data?.acronym !== identity.orgRestriction) {
        return errorResponse("Not found", 404);
      }
      return jsonResponse(record);
    }

    // ---- POST /api/rfps ----
    // Create a new RFP record. Body = the intake form field data.
    if (path === "/api/rfps" && method === "POST") {
      const body = await request.json();
      if (identity.orgRestriction && body.acronym !== identity.orgRestriction) {
        return errorResponse(`You can only create RFPs for ${identity.orgRestriction}.`, 403);
      }
      const id = generateId();
      const now = new Date().toISOString();

      const record = {
        id,
        status: "draft",
        currentVersion: 1,
        data: body,
        createdAt: now,
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
      context.waitUntil(notifyCandela(env, { eventName: body.eventName, groupName: body.groupName }));
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

      if (identity.orgRestriction && record.data?.acronym !== identity.orgRestriction) {
        return errorResponse("Not found", 404);
      }

      // Once an RFP leaves Draft, its intake data is locked for everyone
      // — no exception for admins or the planner. Status changes are a
      // separate endpoint (PUT /api/rfps/:id/status) and aren't affected
      // by this; this only blocks editing the RFP's own field data.
      if (record.status !== "draft") {
        return errorResponse(`This RFP is locked for editing because its status is "${record.status}", not "draft". Change its status back to Draft to edit it.`, 403);
      }

      const body = await request.json();
      if (identity.orgRestriction && body.acronym !== identity.orgRestriction) {
        return errorResponse(`You can only edit RFPs for ${identity.orgRestriction}.`, 403);
      }
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
      context.waitUntil(notifyCandela(env, { eventName: body.eventName, groupName: body.groupName }));
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
