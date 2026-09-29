// n8n Code node: "DEMO · Mock Follow-up"  (mode: Run Once for All Items)
// DEMO MODE ONLY. Drafts a professional follow-up email from the lead's own context
// (first name, company, requested service, pain point, stated timeline). No external calls.
// Rules: no invented prices, commitments, guarantees, dates or technical claims;
// anything we do not know stays a [placeholder]. Drafts are NEVER sent automatically.

const GENERATOR = 'mock-followup-v1';

// "Lead qualification" -> "lead qualification", but keep acronyms like "CRM" or "AI" intact.
const lowerFirst = (s) => (s && /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

return $input.all().map((item, i) => {
  const lead = item.json;
  const first = lead.first_name || 'there';
  const company = lead.company || 'your team';
  const service = lead.requested_service || 'workflow automation';
  const pain = (lead.analysis.pain_points || [])[0];
  const painLine = pain
    ? `From your message, it sounds like ${pain}.`
    : `It sounds like you're looking to reduce manual work around ${lowerFirst(service)}.`;
  const timelineLine = lead.timeline ? ` You mentioned a timeline of "${lead.timeline}", which is helpful context.` : '';

  let subject;
  let body;

  if (lead.lead_category === 'HOT') {
    subject = `Next steps: ${service} for ${company}`;
    body = [
      `Hi ${first},`,
      '',
      `Thanks for reaching out about ${lowerFirst(service)} for ${company}. ${painLine}${timelineLine}`,
      '',
      'I would suggest a short discovery call to walk through your current process, the systems involved, and what a sensible first phase could look like.',
      '',
      'Would one of these times work for you? [Proposed time slots]',
      'Or pick a slot that suits you here: [Calendar Link]',
      '',
      'Best regards,',
      '[Your Name]',
      '[Your Company]',
    ].join('\n');
  } else if (lead.lead_category === 'WARM') {
    subject = `Re: ${service} - a few questions for ${company}`;
    body = [
      `Hi ${first},`,
      '',
      `Thanks for getting in touch about ${lowerFirst(service)}. ${painLine}${timelineLine}`,
      '',
      'To put together a rough scope, it would help to understand:',
      '1. Roughly how many inbound leads you handle per week',
      '2. Which details matter most when deciding if a lead is a good fit',
      '3. How leads are currently handed over to your team',
      '',
      'Here is a short example of a similar workflow: [Case Study Link]',
      'If it is easier, we can go through this on a short call: [Calendar Link]',
      '',
      'Best regards,',
      '[Your Name]',
      '[Your Company]',
    ].join('\n');
  } else {
    subject = `Thanks for your interest, ${first}`;
    body = [
      `Hi ${first},`,
      '',
      `Thanks for reaching out. It sounds like you're still exploring what automation could do for ${company}, which is a good place to start.`,
      '',
      'Here are a couple of resources that show what is possible:',
      '- [Resource Link 1]',
      '- [Resource Link 2]',
      '',
      'Whenever you would like to discuss specifics, just reply to this email or book a time here: [Calendar Link]',
      '',
      'Best regards,',
      '[Your Name]',
      '[Your Company]',
    ].join('\n');
  }

  return {
    json: {
      ...lead,
      followup: {
        channel: 'email',
        to: lead.email,
        subject,
        body,
        status: 'DRAFT_PENDING_REVIEW',
        auto_send: false,
        generated_by: GENERATOR,
        placeholders: [...new Set(body.match(/\[[^\]]+\]/g) || [])],
      },
    },
    pairedItem: { item: i },
  };
});
