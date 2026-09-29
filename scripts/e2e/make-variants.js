// Creates the three e2e workflow variants (demo, prod with AI disabled, prod with AI enabled but no network/credential).
const fs = require('fs');
const [src, outDir] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(src, 'utf8'));
const setDemo = (wf, v) => {
  wf.nodes.find((n) => n.name === 'Config').parameters.assignments.assignments.find((a) => a.name === 'config.demo_mode').value = v;
};
const variants = {
  demo: (wf) => wf,
  prod_ai_disabled: (wf) => { setDemo(wf, false); return wf; },
  prod_ai_no_network: (wf) => {
    setDemo(wf, false);
    wf.nodes.filter((n) => n.name === 'AI · Analyze Lead' || n.name === 'AI · Draft Follow-up').forEach((n) => { n.disabled = false; });
    return wf;
  },
};
let i = 0;
for (const [name, fn] of Object.entries(variants)) {
  const wf = fn(JSON.parse(JSON.stringify(base)));
  wf.id = `LeadCrmE2eTest${++i}`.padEnd(16, 'x').slice(0, 16);
  wf.name = `${base.name} [e2e ${name}]`;
  fs.writeFileSync(`${outDir}/wf_${name}.json`, JSON.stringify(wf));
}
console.log('variants written');
