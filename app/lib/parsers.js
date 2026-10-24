// 把各家 CLI 的串流事件轉成統一格式；只回報事件裡真的出現的動作，不推測進度
// 事件：{type:'tool', phase:'start'|'end', name, query?, url?, path?, command?} {type:'text'} {type:'thinking'} {type:'ratelimit', info} {type:'usage', usage}
const TOOL_LABEL = n => /search/i.test(n) ? 'search' : /fetch|url|browser|read_url/i.test(n) ? 'web' : /read|view|grep|glob|find|list_dir/i.test(n) ? 'read'
  : /write|edit|replace|sed|notebook/i.test(n) ? 'write' : /bash|powershell|command|exec/i.test(n) ? 'exec' : 'tool';

function pick(input = {}) {
  const o = {};
  for (const [k, v] of Object.entries(input)) {
    const key = k.toLowerCase();
    if (typeof v !== 'string') continue;
    if (key === 'query' || key === 'q') o.query = v.slice(0, 300);
    else if (key === 'url' || key === 'uri') o.url = v.slice(0, 500);
    else if (/path|file/.test(key)) o.path = v.slice(0, 300);
    else if (key === 'command' || key === 'commandline') o.command = v.slice(0, 300);
  }
  return o;
}

function createParser(kind) {
  let buf = '', final = null, error = null, usage = null, rateLimit = null, texts = [];
  const handlers = {
    claude(j, out) {
      if (j.type === 'assistant') for (const c of j.message?.content || []) {
        if (c.type === 'tool_use') out.push({ type: 'tool', phase: 'start', name: c.name, kind: TOOL_LABEL(c.name), ...pick(c.input) });
        else if (c.type === 'text' && c.text) { texts.push(c.text); out.push({ type: 'text' }); }
        else if (c.type === 'thinking') out.push({ type: 'thinking' });
      }
      else if (j.type === 'user') for (const c of j.message?.content || []) { if (c.type === 'tool_result') out.push({ type: 'tool', phase: 'end', error: !!c.is_error }); }
      else if (j.type === 'rate_limit_event') { rateLimit = j.rate_limit_info; out.push({ type: 'ratelimit', info: rateLimit }); }
      else if (j.type === 'result') {
        usage = j.usage || null;
        if (j.subtype === 'success' && !j.is_error) final = String(j.result ?? texts.at(-1) ?? '');
        else error = j.subtype === 'error_max_turns' ? 'Error: Reached max turns' : String(j.result || j.error || j.subtype || '執行失敗');
      }
    },
    codex(j, out) {
      const it = j.item;
      if (j.type === 'item.started' && it) {
        if (it.type === 'web_search') out.push({ type: 'tool', phase: 'start', name: 'web_search', kind: 'search', query: it.query || it.action?.query || '' });
        else if (it.type === 'command_execution') out.push({ type: 'tool', phase: 'start', name: 'command', kind: 'exec', command: String(it.command || '').slice(0, 300) });
        else if (it.type === 'file_change') out.push({ type: 'tool', phase: 'start', name: 'file_change', kind: 'write' });
      } else if (j.type === 'item.completed' && it) {
        if (it.type === 'agent_message') { texts.push(it.text || ''); out.push({ type: 'text' }); }
        else if (it.type === 'reasoning') out.push({ type: 'thinking' });
        else if (it.type === 'web_search') out.push({ type: 'tool', phase: 'end', name: 'web_search', kind: 'search', query: it.action?.query || it.query || '',
          domains: (it.results || []).map(r => r.domain || r.url).filter(Boolean).slice(0, 10) });
        else out.push({ type: 'tool', phase: 'end', name: it.type });
      } else if (j.type === 'turn.completed') { usage = j.usage || null; final = texts.at(-1) ?? ''; }
      else if (j.type === 'turn.failed' || j.type === 'error') error = String(j.error?.message || j.message || j.error || 'Codex 執行失敗');
    },
    agy(j, out) {
      const s = j.step_update;
      if (j.event === 'step_update' && s) {
        if (s.step_type === 'tool') out.push({ type: 'tool', phase: s.state === 'DONE' ? 'end' : 'start', name: s.tool_name, kind: TOOL_LABEL(s.tool_name || ''), ...pick(s.tool_info?.parameters) });
        else if (s.step_type === 'agent_response' && s.text_delta) out.push({ type: 'text' });
        if (s.usage) usage = s.usage;
      } else if (j.event === 'result') {
        const r = j.result || {};
        if (r.status === 'SUCCESS') final = String(r.response || '');
        else error = String(r.error || r.status || 'Antigravity 執行失敗');
        usage = r.usage || usage;
      }
    },
  };
  const h = handlers[kind];
  return {
    push(chunk) {
      if (!h) { buf += chunk; return [{ type: 'text' }]; }
      buf += chunk; const out = [], lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) { if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; } h(j, out); }
      return out;
    },
    end() {
      if (!h) return { text: buf.trim(), error: null, usage: null, rateLimit: null };
      if (buf.trim()) { try { h(JSON.parse(buf), []); } catch {} }
      if (final === null && !error && texts.length) final = texts.at(-1);
      return { text: (final || '').trim(), error, usage, rateLimit };
    },
  };
}

module.exports = { createParser, TOOL_LABEL };
