// Round 6: phone held sideways (844x390), after the landscape layout fix.
module.exports = { query: '&new=1&coach=1', steps: [
  { js: "document.getElementById('t-go')?.click(); 'go'" },
  { sim: 1 },
  { js: "document.querySelector('.emote-toggle').click(); 'fan'" },
  { label: 'fan', sim: 0.2, shot: 'r6-01-landscape-signals', page: true },
  { js: "document.querySelector('.emote-toggle').click(); 'closed'" },
  { label: 'camp prompt', sim: 0.3, shot: 'r6-02-landscape-prompt', page: true },
  { label: 'pilot to rapid', sim: 240, opts: { pilot: 'down', until: 'g.caller.rapid' } },
  { label: 'rapid', sim: 4, opts: { bot: 'perfect' } },
  { label: 'rapid', frames: 1, shot: 'r6-03-landscape-rapid', page: true },
]};
