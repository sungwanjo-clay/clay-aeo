def handler(context):
    g = context.get_input
    ok = bool(g('recipe_ok'))
    cached = g('cached_recipe') or {}
    d = {k: g('new_' + k) for k in ('method', 'list_url', 'needs_js', 'link_pattern', 'profile_pattern', 'expected_count', 'recipe_notes')}
    use_new = (not ok) and bool(d.get('method'))
    src = d if use_new else cached
    method = (src.get('method') or 'agent_only') if (ok or use_new) else 'agent_only'
    list_url = (src.get('list_url') or '').strip()
    needs_js = bool(src.get('needs_js')) if not isinstance(src.get('needs_js'), str) else src.get('needs_js').lower() == 'true'
    fetch = [{'url': list_url, 'needs_js': needs_js, 'wait': 5 if needs_js else 0}] if list_url and method not in ('agent_only',) else []
    if fetch:
        root = '/'.join(list_url.split('/')[:3])
        fetch.append({'url': root + '/robots.txt', 'needs_js': False, 'wait': 0})   # always readable; keeps the step from failing outright
    def num(x):
        try: return int(float(x or 0))
        except (ValueError, TypeError): return 0
    return {'method': method, 'fetch': fetch, 'source_url': list_url or (cached.get('url') or ''),
            'link_pattern': src.get('link_pattern') or '', 'profile_pattern': src.get('profile_pattern') or '',
            'expected_count': num(src.get('expected_count')), 'last_count': num(cached.get('last_count')) if not use_new else 0,
            'checkpoint_date': cached.get('checkpoint_date') or '', 'is_new_recipe': use_new, 'recipe_notes': d.get('recipe_notes') or ''}
