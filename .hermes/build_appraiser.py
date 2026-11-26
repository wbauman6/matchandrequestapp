import json, html

d = json.load(open('.hermes/appraiser-data.json'))
rows, unmet, total, appraisers = d['rows'], d['unmet'], d['totalItems'], d['appraisers']

TH = 'padding:10px 16px;font-size:12px;color:#6d7175;font-weight:600;text-align:left'


def stat(label, value, tone=None):
    col = "#a85100" if tone == "warn" else "#1a7a4a" if tone == "ok" else "#202223"
    return (f'<div><div style="font-size:26px;font-weight:700;color:{col}">{value}</div>'
            f'<div style="font-size:12px;color:#6d7175">{html.escape(label)}</div></div>')


tr = ""
for r in rows:
    nothing = r['matchCount'] == 0
    bg, fg = ("#fff5ea", "#a85100") if nothing else ("#e3f1df", "#1a7a4a")
    tag = "Nothing found" if nothing else f'{r["matchCount"]} to show'
    age = "Today" if r['ageDays'] == 0 else f'{r["ageDays"]} day{"" if r["ageDays"] == 1 else "s"}'
    agecol = "#a85100" if r['ageDays'] > 30 else "#6d7175"
    tr += f'''<tr style="border-bottom:1px solid #e1e3e5">
<td style="padding:12px 16px"><a href="#" style="color:#005bd3;text-decoration:none;font-weight:600">{html.escape(r["description"][:72])}</a></td>
<td style="padding:12px 16px;color:#6d7175;font-size:13px">{html.escape(r["customerName"])}</td>
<td style="padding:12px 16px;color:{agecol};font-size:13px">{age}</td>
<td style="padding:12px 16px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 9px;border-radius:10px;background:{bg};color:{fg}">{tag}</span></td></tr>'''

appr_line = (f'<p style="color:#6d7175;font-size:12px;margin:14px 0 0">Appraisers: {html.escape(", ".join(appraisers))}</p>'
             if appraisers else
             '<p style="color:#8c9196;font-size:12px;margin:14px 0 0">No one has the Appraiser role yet &mdash; set it in Settings. The page works regardless.</p>')

page = f'''<!doctype html><html><head><meta charset="utf-8">
<style>
 body{{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:#202223}}
 .card{{background:#fff;border:1px solid #e1e3e5;border-radius:12px;padding:18px 20px;margin-bottom:16px}}
 .nav{{display:flex;gap:18px;font-size:13px;color:#6d7175;border-bottom:1px solid #e1e3e5;padding-bottom:10px;margin-bottom:16px;flex-wrap:wrap}}
 .nav b{{color:#202223;border-bottom:2px solid #202223;padding-bottom:10px}}
 h2{{font-size:16px;margin:0 0 10px}} table{{width:100%;border-collapse:collapse;font-size:14px}}
 .note{{font-size:12px;color:#8c9196;margin:0 0 14px}}
</style></head><body>
<div class="note">Static render from the real component code and live data &mdash; not a screenshot of the running app.</div>
<div class="nav"><span>Requests</span><span>Matches</span><span>Review</span><b>Appraiser</b><span>History</span><span>Drops</span><span>Settings</span><span>Guide</span></div>

<div class="card">
 <h2>What to appraise first</h2>
 <p style="color:#6d7175;margin:0;font-size:13px;line-height:1.5">
  Requests for pieces with <strong>no designer name</strong> &mdash; the ones that need someone to
  identify and price them. Requests showing <strong>Nothing found</strong> are at the top: a customer
  is asking for something the shop isn&rsquo;t currently showing, so a matching piece waiting to be
  appraised is worth doing first.</p>
 <div style="display:flex;gap:28px;margin-top:16px;flex-wrap:wrap">
  {stat("Need appraising", len(rows))}
  {stat("Nothing found yet", unmet, "warn" if unmet else "ok")}
  {stat("All item requests", total)}
 </div>
 {appr_line}
</div>

<div class="card">
 <h2>Queue ({len(rows)})</h2>
 <div style="overflow-x:auto"><table>
 <thead><tr style="border-bottom:2px solid #e1e3e5">
  <th style="{TH}">What they want</th><th style="{TH}">Customer</th>
  <th style="{TH}">Waiting</th><th style="{TH}">In stock</th></tr></thead>
 <tbody>{tr}</tbody></table></div>
</div>
</body></html>'''

open('.hermes/appraiser-preview.html', 'w', encoding='utf-8').write(page)
print("wrote", len(page), "bytes |", len(rows), "rows")
