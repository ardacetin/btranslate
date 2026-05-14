function patchHostHtml() {
  const fs = require('fs');
  const file = '/Users/arda/Documents/btranslate/frontend/host.html';
  let html = fs.readFileSync(file, 'utf8');

  // Add nativeCtx.resume()
  html = html.replace('const nativeRate = nativeCtx.sampleRate;', 
    'const nativeRate = nativeCtx.sampleRate;\n        if (nativeCtx.state === \'suspended\') await nativeCtx.resume();');
    
  fs.writeFileSync(file, html);
}
patchHostHtml();
