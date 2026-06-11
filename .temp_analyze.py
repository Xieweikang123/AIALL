import re
lines = open('D:/project/AIALL/src/views/VibeCodingView.vue', 'r', encoding='utf-8').readlines()

funcs = []
for i, l in enumerate(lines):
    s = l.strip()
    m = re.match(r'^(?:async )?function (\w+)', s)
    if m:
        name = m.group(1)
        end = i + 1
        brace = 0
        while end < len(lines) and (brace > 0 or end == i + 1):
            brace += lines[end].count('{') - lines[end].count('}')
            end += 1
        body = ''.join(lines[i:end])
        uses_value = '.value' in body
        uses_local_storage = 'localStorage' in body
        funcs.append({'name': name, 'line': i+1, 'size': end-i, 'uses_value': uses_value, 'uses_local_storage': uses_local_storage})

pure = [f for f in funcs if not f['uses_value'] and not f['uses_local_storage']]
impure = [f for f in funcs if f['uses_value'] or f['uses_local_storage']]

print('=== PURE functions ===')
for f in sorted(pure, key=lambda x: -x['size']):
    print(f'  {f["name"]}: {f["size"]} lines')
print(f'  Total: {sum(f["size"] for f in pure)} lines')

print()
print('=== IMPURE functions ===')
for f in sorted(impure, key=lambda x: -x['size']):
    print(f'  {f["name"]}: {f["size"]} lines')
