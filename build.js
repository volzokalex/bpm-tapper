const fs = require('fs');
const { version } = require('./package.json');

const html = fs.readFileSync('index.html', 'utf8');
const updated = html.replace(/v[\d.]+(?=<\/div>)/, `v${version}`);
fs.writeFileSync('index.html', updated);
console.log(`Version set to v${version}`);
