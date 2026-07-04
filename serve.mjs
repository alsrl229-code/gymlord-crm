import http from 'http';
import fs from 'fs';
import path from 'path';

const DIR = '/Users/mingki/Downloads/gymlord-crm/app';
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(DIR, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
    res.end(data);
  });
}).listen(4178, () => console.log('gymlord app on http://localhost:4178'));
