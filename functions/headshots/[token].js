// Member-facing headshot page: https://events.clearhq.org/headshots/<token>
// Optional env vars: HEADSHOT_EVENT_NAME (e.g. "2026 Annual Educational Conference"),
//                    HEADSHOT_CONTACT_EMAIL (shown on the page for questions)

export async function onRequestGet({ params, env }) {
  const raw = String(params.token || '');
  const token = /^[A-Za-z0-9_-]{22}$/.test(raw) ? raw : '';
  const contact = /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[A-Za-z]{2,}$/.test(env.HEADSHOT_CONTACT_EMAIL || '')
    ? env.HEADSHOT_CONTACT_EMAIL : '';
  const eventName = escapeHtml(env.HEADSHOT_EVENT_NAME || 'CLEAR conference headshots');

  const html = PAGE
    .split('__TOKEN__').join(token)
    .split('__CONTACT__').join(contact)
    .split('__EVENT__').join(eventName);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Your headshots | CLEAR</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root { --burgundy:#64092C; --gold:#DDA838; --charcoal:#484848; --blue:#084D78; --paper:#faf8f6; --line:#e7e0d9; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"Open Sans","Trebuchet MS",Arial,sans-serif; color:#2b2b2b; background:var(--paper); line-height:1.55; }
  .band { background:var(--burgundy); color:#fff; padding:calc(32px + env(safe-area-inset-top, 0px)) 24px 76px; border-bottom:5px solid var(--gold); }
  .wrap { max-width:1080px; margin:0 auto; }
  .band-row { display:flex; align-items:center; justify-content:space-between; gap:32px; }
  .band-text { min-width:0; }
  .logo-plate { flex:none; background:#fff; border-radius:6px; padding:12px 18px; }
  .logo-plate img { display:block; height:84px; width:auto; max-width:100%; }
  .sponsor { display:flex; align-items:center; gap:28px; margin-top:48px; padding:24px 28px; background:#fff; border:1px solid var(--line); border-left:6px solid var(--gold); border-radius:4px; }
  .sponsor .s-logo { flex:none; padding-right:28px; border-right:1px solid var(--line); }
  .sponsor .s-logo img { display:block; height:56px; width:auto; max-width:100%; }
  .sponsor h2 { margin:0 0 4px; font-size:18px; line-height:1.3; color:var(--burgundy); }
  .sponsor p { margin:0; font-size:14px; color:var(--charcoal); max-width:52ch; }
  @media (max-width:680px) {
    .band-row { flex-direction:column-reverse; align-items:flex-start; gap:18px; }
    .logo-plate img { height:60px; }
    .sponsor { flex-direction:column; align-items:flex-start; gap:16px; }
    .sponsor .s-logo { padding-right:0; border-right:0; }
  }
  h1 { font-size:clamp(30px, 5.5vw, 48px); line-height:1.12; margin:12px 0 10px; font-weight:700; max-width:18ch; }
  .sub { margin:0; max-width:60ch; color:#f3e6ea; }
  main { padding:0 24px calc(64px + env(safe-area-inset-bottom, 0px)); }
  .lift { margin-top:-48px; }
  .actions { display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-bottom:22px; }
  .btn-all { background:var(--gold); color:#2a1b00; border:0; border-radius:4px; padding:14px 24px; font:700 16px "Open Sans",sans-serif; cursor:pointer; box-shadow:0 3px 0 #a87d1e; }
  .btn-all:disabled { opacity:.75; cursor:progress; }
  .btn-all:focus-visible, a:focus-visible { outline:3px solid var(--blue); outline-offset:3px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:22px; }
  figure { margin:0; background:#fff; border:1px solid var(--line); border-radius:4px; overflow:hidden; }
  figure a.view { display:block; background:#ece7e2; }
  figure img { display:block; width:100%; aspect-ratio:4 / 5; object-fit:cover; }
  figcaption { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 14px; font-size:13px; color:var(--charcoal); }
  figcaption a.dl { color:var(--blue); font-weight:700; text-decoration:none; white-space:nowrap; }
  figcaption a.dl:hover { text-decoration:underline; }
  .notes { margin-top:36px; max-width:62ch; font-size:14px; color:var(--charcoal); }
  .notes p { margin:0 0 10px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:4px; padding:28px; max-width:620px; }
  .card p { margin:0 0 10px; }
  .skeleton { height:280px; background:#fff; border:1px solid var(--line); border-radius:4px; }
  a { color:var(--blue); }
  @media (max-width:520px) { .grid { grid-template-columns:1fr 1fr; gap:12px; } figcaption { flex-direction:column; align-items:flex-start; } }
</style>
</head>
<body>
  <div class="band">
    <div class="wrap band-row">
      <div class="band-text">
        <h1 id="title">Your headshots</h1>
        <p class="sub" id="sub">Loading your photos…</p>
      </div>
      <div class="logo-plate"><img src="https://clearlearning.github.io/digitalsignage/CLEAR25_PortlandLogo_FullColor.png" alt="__EVENT__"></div>
    </div>
  </div>
  <main>
    <div class="wrap lift" id="content"><div class="skeleton"></div></div>
    <aside class="wrap sponsor" aria-label="Sponsor">
      <div class="s-logo"><img src="https://clearlearning.github.io/digitalsignage/pearson.png" alt="Pearson"></div>
      <div>
        <h2>Headshots made possible by Pearson</h2>
        <p>Thank you to Pearson for sponsoring professional headshots for CLEAR members at this year's conference.</p>
      </div>
    </aside>
  </main>
<script>
(function () {
  var token = '__TOKEN__';
  var contact = '__CONTACT__';
  var api = '/api/headshots/p/' + token;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function contactLine() {
    return contact ? '<p>Questions? Email <a href="mailto:' + contact + '">' + contact + '</a>.</p>' : '';
  }
  function showMessage(title, body) {
    $('title').textContent = title;
    $('sub').textContent = '';
    $('content').innerHTML = '<div class="card"><p>' + body + '</p>' + contactLine() + '</div>';
  }

  if (!token) { showMessage('Link not recognized', 'This link is incomplete. Open the link from your email again, or copy the whole address into your browser.'); return; }

  fetch(api).then(function (r) {
    if (r.status === 410) { showMessage('This link has expired', 'Your headshots are no longer available at this link.'); return null; }
    if (!r.ok) { showMessage('Link not recognized', 'We could not find photos for this link. Check that you copied the whole address from your email.'); return null; }
    return r.json();
  }).then(function (d) {
    if (d) render(d);
  }).catch(function () {
    showMessage('Photos could not load', 'Check your internet connection and reload the page.');
  });

  function render(d) {
    var n = d.photos.length;
    $('title').textContent = (d.first ? d.first + ', here' : 'Here') + ' are your headshots';
    $('sub').textContent = n + (n === 1 ? ' photo is' : ' photos are') + ' ready to download.' +
      (d.expires ? ' They are available until ' + new Date(d.expires).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + '.' : '');

    var cards = d.photos.map(function (p) {
      var full = api + '/' + p.i;
      return '<figure>' +
        '<a class="view" href="' + full + '" target="_blank" rel="noopener"><img src="' + full + '?v=preview" alt="Headshot ' + (p.i + 1) + ' of ' + n + '" loading="lazy"></a>' +
        '<figcaption><span>Photo ' + (p.i + 1) + ' of ' + n + '</span><a class="dl" href="' + full + '?dl=1" download="' + esc(p.name) + '">Download</a></figcaption>' +
        '</figure>';
    }).join('');

    $('content').innerHTML =
      (n > 1 ? '<div class="actions"><button class="btn-all" id="all" type="button">Download all ' + n + ' photos (.zip)</button></div>' : '') +
      '<div class="grid">' + cards + '</div>' +
      '<div class="notes">' +
        '<p>Each download is the full-resolution file from the photographer, ready for LinkedIn, your agency directory, or a speaker bio.</p>' +
        '<p>On a phone, press and hold a photo and choose Save to Photos. The Download link saves to your Files app instead.</p>' +
        '<p>This link is personal to you. Please don\\'t forward it.</p>' +
        contactLine() +
      '</div>';

    var btn = $('all');
    if (btn) btn.addEventListener('click', function () { zipAll(d, btn); });
  }

  function loadZip() {
    return new Promise(function (res, rej) {
      if (window.JSZip) return res();
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('the zip library did not load')); };
      document.head.appendChild(s);
    });
  }

  async function zipAll(d, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    try {
      btn.textContent = 'Preparing download…';
      await loadZip();
      var zip = new JSZip();
      for (var i = 0; i < d.photos.length; i++) {
        btn.textContent = 'Adding photo ' + (i + 1) + ' of ' + d.photos.length + '…';
        var r = await fetch(api + '/' + i);
        if (!r.ok) throw new Error('photo ' + (i + 1) + ' did not download');
        zip.file(d.photos[i].name, await r.blob());
      }
      btn.textContent = 'Building zip…';
      var blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ((d.first || '') + '-' + (d.last || '')).replace(/[^A-Za-z0-9-]+/g, '').replace(/^-|-$/g, '') + '-headshots.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 15000);
      btn.textContent = 'Download all again';
    } catch (e) {
      btn.textContent = label;
      alert('The zip could not be built because ' + e.message + '. You can still download each photo individually.');
    }
    btn.disabled = false;
  }
})();
</script>
</body>
</html>`;
