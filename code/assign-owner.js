// n8n Code node: "Assign Owner"  (mode: Run Once for All Items)
// Picks a named owner from the team roster in Config (config.owners), based on the team the
// route stamped in routing.owner_team. Assignment is a stable hash of lead_id (round-robin-like,
// reproducible). Duplicates go to the owner of the original lead when it is in the same batch.
// If a follow-up draft exists, the [Your Name] placeholder is filled with the assigned person.

const items = $input.all();

const hash = (s) => {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

const pickOwner = (lead) => {
  const roster = (lead.config && lead.config.owners) || {};
  const team = lead.routing.owner_team;
  const members = roster[team] || [];
  if (!members.length) return { owner: `${team} queue`, method: 'team queue (no roster configured)' };
  return { owner: members[hash(lead.lead_id) % members.length], method: `stable round-robin within "${team}"` };
};

// First pass: originals. Second pass: duplicates (inherit the original owner).
const ownerById = {};
const assigned = items.map((item) => {
  const lead = item.json;
  if (lead.lead_category === 'DUPLICATE') return null;
  const r = pickOwner(lead);
  ownerById[lead.lead_id] = r.owner;
  return r;
});

return items.map((item, i) => {
  const lead = item.json;
  let r = assigned[i];
  if (!r) {
    const originalOwner = ownerById[lead.duplicate_check.duplicate_of];
    r = originalOwner
      ? { owner: originalOwner, method: `owner of original lead ${lead.duplicate_check.duplicate_of}` }
      : pickOwner(lead);
  }

  let followup = lead.followup;
  const isPerson = !/queue|system|automation/i.test(r.owner);
  if (followup && followup.body && isPerson) {
    followup = { ...followup, body: followup.body.replace('[Your Name]', r.owner) };
    followup.placeholders = [...new Set(followup.body.match(/\[[^\]]+\]/g) || [])];
  }

  return {
    json: {
      ...lead,
      ...(followup ? { followup } : {}),
      owner: r.owner,
      owner_team: lead.routing.owner_team,
      assignment_method: r.method,
    },
    pairedItem: { item: i },
  };
});
