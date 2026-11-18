// Quick check of the ProContent sign-in filler against a script-built form. node pcfill-check.js
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const src = fs.readFileSync(__dirname + '/../desktop/procontent.js', 'utf8');
const FILL_SCRIPT = eval(src.match(/const FILL_SCRIPT = ([\s\S]*?\}\)\(\$\{JSON\.stringify\(email\)\}, \$\{JSON\.stringify\(password\)\}\)`);/)[1]);
const main = fs.readFileSync(__dirname + '/../desktop/main.js', 'utf8');
const LOGIN = eval(main.match(/const LOGIN_PAGE = (`[\s\S]*?<\/script>`);/)[1]);
let posted = null;
const srv = http.createServer((req, res) => {
  if (req.url === '/session') { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { posted = JSON.parse(b); res.writeHead(200); res.end('{}'); }); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url === '/login' ? LOGIN : '<p>account</p>');
}).listen(8798, async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8798/login');
  const r = await p.evaluate(FILL_SCRIPT('kids@example.org', 'pa55 "word"'));
  await p.waitForURL(/account/, { timeout: 5000 }).catch(() => {});
  const ok = r === 'submitted' && posted && posted.e === 'kids@example.org' && posted.p === 'pa55 "word"' && /account/.test(p.url());
  console.log('result:', r, '| posted:', JSON.stringify(posted), '| now at:', p.url());
  console.log(ok ? 'ERRORS: none' : 'ERRORS: filler failed');
  await b.close(); srv.close();
  process.exit(ok ? 0 : 1);
});
