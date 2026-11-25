// Round 7: final phone check of the camp prompt (portrait), plus the coach's arrow ahead.
module.exports = { query: '&new=1&coach=1', steps: [
  { js: "document.getElementById('t-go')?.click(); 'go'" },
  { label: 'camp prompt', sim: 1, shot: 'r7-01-portrait-prompt', page: true },
  { js: "document.querySelector('#h-prompt').innerText", label: 'prompt text' },
]};
