'use strict';
// v38: test double for contact research. Spends nothing and never touches the network. Used by npm test and --dry-run.
function createMockProvider(opts = {}) {
  const calls = []; let balance = opts.balance == null ? 100 : opts.balance;
  const titles = opts.titles || ['Chief Technology Officer', 'Vice President Energy', 'Head Electrical and MEP', 'HR Manager', 'Director Critical Facilities', 'Talent Acquisition Lead', 'Procurement Head', 'Sales Executive', 'Project Director', 'Data Center Operations Manager', 'Sustainability Lead', 'Engineer'];
  const spend = (n) => { if (opts.billing !== false) balance -= n; };
  return {
    kind: 'mock', connected: true, calls,
    async balance() { return balance; },
    async company(domain) { calls.push(['company', domain]); spend(1); return { name: domain.split('.')[0].toUpperCase(), city: 'Mumbai', founded: '2010', website: 'www.' + domain, industry: 'Data centres', size: '1001-5000', related_domains: [], people_listed: 500 }; },
    async people(domain, { page = 1, positions = [] } = {}) { calls.push(['people', domain, page, positions.length]); if (positions.length && opts.filteredEmpty !== false) return { items: [], total: 0 }; spend(1); return { items: titles.map((t, i) => ({ first_name: 'Person' + i, last_name: 'test', position: t, profile_url: 'https://www.linkedin.com/in/test-' + i, ref: 'mock:' + domain + ':' + i })), total: titles.length }; },
    async email(p) { calls.push(['email', p.ref]); spend(1); return { email: p.first_name.toLowerCase() + '@example.com', status: 'valid' }; }
  };
}
module.exports = { createMockProvider };
