import json, html

d = json.load(open('.hermes/admin-data.json'))
c, rows, staff = d['counts'], d['rows'], d['salespeople']

BTN = "border:1px solid #d7d9dc;background:#fff;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;"

KIND_LABEL = {"item": "Looking for an item", "service": "Repair or service",
              "buying": "Wants to sell to us", "question": "General question",
              "price": "Asking about price", "spam": "Not a customer",
              "vague": "Needs more detail"}

chips = [("all", "All", c['all']), ("needsDetail", "Needs more detail", c['needsDetail']),
         ("nonItem", "Not an item request", c['nonItem']), ("needsCall", "Needs a call", c['needsCall']),
         ("website", "From website", c['website']), ("noMatches", "Nothing found yet", c['noMatches']),
         ("problems", "Problems", c['problems'])]

chip_html = ""
for key, label, n in chips:
    if key != "all" and n == 0:
        continue
    if key == "all":
        st = "border:1px solid #005bd3;background:#f1f8ff;color:#005bd3;"
    else:
        st = "border:1px solid #c9cccf;background:#fff;color:#414547;"
    chip_html += (f'<button style="{st}border-radius:20px;padding:5px 14px;font-size:13px;'
                  f'font-weight:600;cursor:pointer;margin:0 8px 8px 0;">{html.escape(label)} ({n})</button>')


def badge(txt, bg, fg):
    return (f'<span style="margin-left:6px;font-size:10px;font-weight:700;text-transform:uppercase;'
            f'letter-spacing:.5px;padding:2px 8px;border-radius:10px;background:{bg};color:{fg};'
            f'white-space:nowrap;">{html.escape(txt)}</span>')


tr = ""
for r in rows:
    b = ""
    if r['source'] == "customer":
        b += badge("Called", "#e3f1df", "#1a7a4a") if r['calledAt'] else badge("Call customer", "#fff5ea", "#a85100")
    if r['requestKind'] != "item":
        b += badge(KIND_LABEL.get(r['requestKind'], r['requestKind']), "#eef0f2", "#5c5f62")
    pin = '&#128204; ' if r['pinned'] else ''
    contact = f'<div style="font-size:12px;color:#6d7175">{html.escape(r["phone"] or r["email"] or "")}</div>'

    if r['requestKind'] == "item":
        opts = "".join(f'<option {"selected" if s == r["salespersonName"] else ""}>{html.escape(s)}</option>' for s in staff)
        if r['salespersonName'] not in staff:
            opts = f'<option selected>{html.escape(r["salespersonName"])}</option>' + opts
        sp = (f'<select style="border:1px solid #d7d9dc;border-radius:6px;padding:4px 6px;font-size:13px;'
              f'color:#6d7175;background:#fff;max-width:150px">{opts}</select>')
    else:
        sp = f'<span style="color:#6d7175">{html.escape(r["salespersonName"])}</span>'

    m = (f'<a href="#" style="color:#005bd3;font-weight:600;text-decoration:none">{r["matches"]}</a>'
         if r['matches'] > 0 else '<span style="color:#c9cccf">&mdash;</span>')

    called_btn = ""
    if r['source'] == "customer":
        if r['calledAt']:
            called_btn = f'<button style="{BTN}color:#6d7175">Undo called</button>'
        else:
            called_btn = f'<button style="{BTN}color:#a85100;font-weight:600">Mark called</button>'

    budget = f'${r["budget"]:,}' if r['budget'] else '<span style="color:#c9cccf">&mdash;</span>'

    tr += f'''<tr style="border-bottom:1px solid #e1e3e5">
<td style="padding:12px 16px"><div style="font-weight:600">{pin}<a href="#" style="color:#005bd3;text-decoration:none">{html.escape(r["customerName"])}</a>{b}</div>{contact}
<div style="font-size:13px;color:#42474a;margin-top:4px;max-width:430px">{html.escape(r["description"][:115])}</div></td>
<td style="padding:12px 16px">{sp}</td>
<td style="padding:12px 16px;font-size:13px">{budget}</td>
<td style="padding:12px 16px;font-size:13px">{m}</td>
<td style="padding:12px 16px"><div style="display:flex;gap:6px;flex-wrap:wrap">{called_btn}<button style="{BTN}">Pin</button><button style="{BTN}color:#1a7a4a">Fulfill</button><button style="{BTN}">Archive</button></div></td></tr>'''

TH = 'padding:10px 16px;font-size:12px;color:#6d7175;font-weight:600;text-align:left'

page = f'''<!doctype html><html><head><meta charset="utf-8">
<style>
 body{{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:#202223;}}
 .card{{background:#fff;border:1px solid #e1e3e5;border-radius:12px;padding:18px 20px;margin-bottom:16px;}}
 .nav{{display:flex;gap:18px;font-size:13px;color:#6d7175;border-bottom:1px solid #e1e3e5;padding-bottom:10px;margin-bottom:16px;flex-wrap:wrap}}
 .nav b{{color:#202223;border-bottom:2px solid #202223;padding-bottom:10px}}
 h2{{font-size:16px;margin:0 0 12px}}
 table{{width:100%;border-collapse:collapse;font-size:14px}}
 .note{{font-size:12px;color:#8c9196;margin:0 0 14px}}
</style></head><body>
<div class="note">Static render from the real component code and live data &mdash; not a screenshot of the running app.</div>
<div class="nav"><b>Requests</b><span>Matches</span><span>Review</span><span>Appraiser</span><span>History</span><span>Drops</span><span>Settings</span><span>Guide</span></div>
<div class="card">
 <h2>Active Requests ({c['all']})</h2>
 <div style="margin-bottom:14px">{chip_html}</div>
 <div style="overflow-x:auto"><table>
  <thead><tr style="border-bottom:2px solid #e1e3e5">
   <th style="{TH}">Customer &amp; what they want</th><th style="{TH}">Salesperson</th>
   <th style="{TH}">Budget</th><th style="{TH}">Matches</th><th style="{TH}">Actions</th></tr></thead>
  <tbody>{tr}</tbody></table></div>
 <div class="note" style="margin:12px 0 0">Showing {len(rows)} of {c['all']} active.</div>
</div>
</body></html>'''

open('.hermes/admin-preview.html', 'w', encoding='utf-8').write(page)
print("wrote .hermes/admin-preview.html", len(page), "bytes")
