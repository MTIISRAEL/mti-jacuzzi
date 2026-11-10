"""Stamp a new version into the site so open screens notice the update and reload.
Run from the repo root before every commit that changes the site:  python3 tools/bump.py"""
import re, time, io
v = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
def edit(path, fn):
    t = io.open(path, encoding='utf8').read(); n = fn(t); assert n != t, path; io.open(path, 'w', encoding='utf8').write(n)
edit('app.js', lambda t: re.sub(r"var APP_VERSION = '[^']*';", "var APP_VERSION = '%s';" % v, t))
for page in ('index.html', 's.html'):
    edit(page, lambda t: re.sub(r'(href="app\.css|src="(?:firebase-config|models|sketch|app)\.js)(\?v=[^"]*)?"', lambda m: m.group(1) + '?v=' + v + '"', t))
io.open('version.json', 'w', encoding='utf8').write('{"v": "%s"}\n' % v)
print('version', v)
