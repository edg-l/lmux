import { describe, it, expect } from 'bun:test';

import {
	enrichToolMessages,
	parseThinking,
	linkifyText,
	getToolSummary,
	highlightDangers,
	prepareMessagesForApi
} from './chat';
import type { Message, DangerSegment } from '$lib/types/chat';

// ---------------------------------------------------------------------------
// enrichToolMessages
// ---------------------------------------------------------------------------

describe('enrichToolMessages', () => {
	it('returns empty array unchanged', () => {
		expect(enrichToolMessages([])).toEqual([]);
	});

	it('leaves non-tool messages untouched', () => {
		const msgs: Message[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' }
		];
		const result = enrichToolMessages(msgs);
		expect(result).toEqual(msgs);
	});

	it('enriches tool message with name and args from preceding assistant message', () => {
		const msgs: Message[] = [
			{
				role: 'assistant',
				content: '',
				tool_calls: [
					{ id: 'tc1', function: { name: 'read_file', arguments: '{"path":"foo.ts"}' } }
				]
			},
			{ role: 'tool', content: 'file contents', tool_call_id: 'tc1' }
		];
		const result = enrichToolMessages(msgs);
		const toolMsg = result[1];
		expect(toolMsg.toolName).toBe('read_file');
		expect(toolMsg.toolArgs).toBe('{"path":"foo.ts"}');
		expect(toolMsg.toolStatus).toBe('done');
	});

	it('falls back to "tool" when tool_call_id has no matching tool_call', () => {
		const msgs: Message[] = [
			{ role: 'tool', content: 'result', tool_call_id: 'unknown-id' }
		];
		const result = enrichToolMessages(msgs);
		expect(result[0].toolName).toBe('tool');
		expect(result[0].toolArgs).toBeUndefined();
		expect(result[0].toolStatus).toBe('done');
	});

	it('handles multiple tool calls in one assistant message', () => {
		const msgs: Message[] = [
			{
				role: 'assistant',
				content: '',
				tool_calls: [
					{ id: 'a', function: { name: 'web_search', arguments: '{"query":"hi"}' } },
					{ id: 'b', function: { name: 'fetch_url', arguments: '{"url":"http://x.com"}' } }
				]
			},
			{ role: 'tool', content: 'r1', tool_call_id: 'a' },
			{ role: 'tool', content: 'r2', tool_call_id: 'b' }
		];
		const result = enrichToolMessages(msgs);
		expect(result[1].toolName).toBe('web_search');
		expect(result[2].toolName).toBe('fetch_url');
	});

	it('does not modify assistant message itself', () => {
		const assistantMsg: Message = {
			role: 'assistant',
			content: 'thinking',
			tool_calls: [{ id: 'x', function: { name: 'run_command', arguments: '{}' } }]
		};
		const msgs = [assistantMsg];
		const result = enrichToolMessages(msgs);
		expect(result[0]).toEqual(assistantMsg);
	});
});

// ---------------------------------------------------------------------------
// parseThinking
// ---------------------------------------------------------------------------

describe('parseThinking', () => {
	it('returns empty array for empty string', () => {
		expect(parseThinking('')).toEqual([]);
	});

	it('returns single text segment when no think tags present', () => {
		const result = parseThinking('Hello world');
		expect(result).toEqual([{ type: 'text', content: 'Hello world' }]);
	});

	it('parses a single think block', () => {
		const result = parseThinking('<think>reasoning here</think>answer');
		expect(result).toEqual([
			{ type: 'thinking', content: 'reasoning here' },
			{ type: 'text', content: 'answer' }
		]);
	});

	it('parses text before and after think block', () => {
		const result = parseThinking('before <think>middle</think> after');
		expect(result).toEqual([
			{ type: 'text', content: 'before' },
			{ type: 'thinking', content: 'middle' },
			{ type: 'text', content: 'after' }
		]);
	});

	it('uses "..." placeholder for empty think block (streaming)', () => {
		const result = parseThinking('<think></think>response');
		expect(result).toEqual([
			{ type: 'thinking', content: '...' },
			{ type: 'text', content: 'response' }
		]);
	});

	it('handles unclosed think tag (streaming in-progress)', () => {
		const result = parseThinking('<think>partial thought');
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe('thinking');
		expect(result[0].content).toBe('partial thought');
	});

	it('parses multiple think blocks', () => {
		const result = parseThinking('<think>t1</think>mid<think>t2</think>end');
		expect(result).toEqual([
			{ type: 'thinking', content: 't1' },
			{ type: 'text', content: 'mid' },
			{ type: 'thinking', content: 't2' },
			{ type: 'text', content: 'end' }
		]);
	});

	it('trims whitespace inside think block', () => {
		const result = parseThinking('<think>  spaced  </think>');
		expect(result[0].content).toBe('spaced');
	});

	it('returns empty array for whitespace-only string', () => {
		expect(parseThinking('   ')).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// linkifyText
// ---------------------------------------------------------------------------

describe('linkifyText', () => {
	it('returns plain text unchanged (no links, no special chars)', () => {
		expect(linkifyText('hello world')).toBe('hello world');
	});

	it('converts http URL to anchor tag', () => {
		const result = linkifyText('visit http://example.com now');
		expect(result).toContain('<a href="http://example.com"');
		expect(result).toContain('target="_blank"');
		expect(result).toContain('rel="noopener noreferrer"');
	});

	it('converts https URL to anchor tag', () => {
		const result = linkifyText('https://example.com/path?q=1');
		expect(result).toContain('<a href="https://example.com/path?q=1"');
	});

	it('escapes & in plain text', () => {
		expect(linkifyText('a & b')).toBe('a &amp; b');
	});

	it('escapes < and > in plain text', () => {
		expect(linkifyText('a < b > c')).toBe('a &lt; b &gt; c');
	});

	it('escapes HTML special chars but still linkifies URL', () => {
		const result = linkifyText('see https://example.com & more');
		expect(result).toContain('&amp;');
		expect(result).toContain('<a href="https://example.com"');
	});

	it('returns empty string for empty input', () => {
		expect(linkifyText('')).toBe('');
	});
});

// ---------------------------------------------------------------------------
// getToolSummary
// ---------------------------------------------------------------------------

describe('getToolSummary', () => {
	it('returns url for fetch_url', () => {
		expect(getToolSummary('fetch_url', '{"url":"https://x.com"}')).toBe('https://x.com');
	});

	it('returns quoted query for web_search', () => {
		expect(getToolSummary('web_search', '{"query":"bun test"}')).toBe('"bun test"');
	});

	it('returns command for run_command (max 60 chars)', () => {
		const long = 'a'.repeat(80);
		const result = getToolSummary('run_command', `{"command":"${long}"}`);
		expect(result).toBe('a'.repeat(60));
	});

	it('returns short command unchanged for run_command', () => {
		expect(getToolSummary('run_command', '{"command":"bun test"}')).toBe('bun test');
	});

	it('returns path for read_file', () => {
		expect(getToolSummary('read_file', '{"path":"src/app.ts"}')).toBe('src/app.ts');
	});

	it('returns path for write_file', () => {
		expect(getToolSummary('write_file', '{"path":"out.txt"}')).toBe('out.txt');
	});

	it('returns path for edit_file', () => {
		expect(getToolSummary('edit_file', '{"path":"main.ts"}')).toBe('main.ts');
	});

	it('returns path:line for insert_lines', () => {
		expect(getToolSummary('insert_lines', '{"path":"foo.ts","line":5}')).toBe('foo.ts:5');
	});

	it('defaults line to 0 for insert_lines when line is missing', () => {
		expect(getToolSummary('insert_lines', '{"path":"foo.ts"}')).toBe('foo.ts:0');
	});

	it('returns quoted pattern for search_files without glob', () => {
		expect(getToolSummary('search_files', '{"pattern":"TODO"}')).toBe('"TODO"');
	});

	it('returns quoted pattern with glob for search_files', () => {
		expect(getToolSummary('search_files', '{"pattern":"TODO","glob":"*.ts"}')).toBe(
			'"TODO" (*.ts)'
		);
	});

	it('returns path for list_directory', () => {
		expect(getToolSummary('list_directory', '{"path":"/src"}')).toBe('/src');
	});

	it('returns "/" when list_directory has no path', () => {
		expect(getToolSummary('list_directory', '{}')).toBe('/');
	});

	it('returns empty string for unknown tool', () => {
		expect(getToolSummary('unknown_tool', '{"foo":"bar"}')).toBe('');
	});

	it('returns empty string for undefined toolName', () => {
		expect(getToolSummary(undefined, '{}')).toBe('');
	});

	it('returns empty string for undefined toolArgs', () => {
		expect(getToolSummary('read_file', undefined)).toBe('');
	});

	it('returns empty string on invalid JSON', () => {
		expect(getToolSummary('read_file', 'not-json')).toBe('');
	});
});

// ---------------------------------------------------------------------------
// highlightDangers
// ---------------------------------------------------------------------------

describe('highlightDangers', () => {
	it('returns HTML-escaped command when no dangers', () => {
		const result = highlightDangers('bun test', []);
		expect(result).toBe('bun test');
	});

	it('escapes HTML special chars when no dangers', () => {
		expect(highlightDangers('a < b & c > d', [])).toBe('a &lt; b &amp; c &gt; d');
	});

	it('wraps dangerous segment in red span', () => {
		const dangers: DangerSegment[] = [
			{ segment: 'rm -rf dist', label: 'rm -rf', startIndex: 0, endIndex: 11 }
		];
		const result = highlightDangers('rm -rf dist', dangers);
		expect(result).toContain('<span class="text-red-400 font-semibold"');
		expect(result).toContain('title="rm -rf"');
		expect(result).toContain('rm -rf dist');
	});

	it('preserves text before and after the danger segment', () => {
		const cmd = 'bun build && rm -rf dist && echo done';
		// 'bun build && ' is 13 chars, ' rm -rf dist ' spans indices 12-25
		const dangers: DangerSegment[] = [
			{ segment: ' rm -rf dist ', label: 'rm -rf', startIndex: 12, endIndex: 25 }
		];
		const result = highlightDangers(cmd, dangers);
		expect(result.startsWith('bun build &amp;&amp;')).toBe(true);
		expect(result).toContain('&amp;&amp; echo done');
		expect(result).toContain('<span');
	});

	it('handles multiple danger segments in correct order', () => {
		const cmd = 'rm -rf a && git reset --hard';
		const dangers: DangerSegment[] = [
			{ segment: 'git reset --hard', label: 'git reset --hard', startIndex: 12, endIndex: 28 },
			{ segment: 'rm -rf a', label: 'rm -rf', startIndex: 0, endIndex: 8 }
		];
		const result = highlightDangers(cmd, dangers);
		const firstSpan = result.indexOf('<span');
		const secondSpan = result.indexOf('<span', firstSpan + 1);
		expect(firstSpan).toBeLessThan(secondSpan);
		// First span should contain rm -rf label
		expect(result.slice(firstSpan, secondSpan)).toContain('rm -rf');
	});

	it('escapes HTML in the dangerous segment itself', () => {
		const cmd = 'rm <danger>';
		const dangers: DangerSegment[] = [
			{ segment: 'rm <danger>', label: 'rm', startIndex: 0, endIndex: 11 }
		];
		const result = highlightDangers(cmd, dangers);
		expect(result).toContain('&lt;danger&gt;');
		expect(result).not.toContain('<danger>');
	});
});

// ---------------------------------------------------------------------------
// prepareMessagesForApi
// ---------------------------------------------------------------------------

describe('prepareMessagesForApi', () => {
	it('returns empty array for empty input', () => {
		expect(prepareMessagesForApi([])).toEqual([]);
	});

	it('filters out ephemeral roles like tool_status and approval', () => {
		const msgs: Message[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'tool_status' as string, content: 'status' },
			{ role: 'approval' as string, content: 'waiting' }
		];
		const result = prepareMessagesForApi(msgs);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe('user');
	});

	it('keeps user, assistant, tool, and system roles', () => {
		const msgs: Message[] = [
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
			{ role: 'tool', content: 'result', tool_call_id: 'tc1' }
		];
		const result = prepareMessagesForApi(msgs);
		expect(result).toHaveLength(4);
	});

	it('passes through simple text content', () => {
		const msgs: Message[] = [{ role: 'user', content: 'what is 2+2?' }];
		const result = prepareMessagesForApi(msgs);
		expect(result[0].content).toBe('what is 2+2?');
	});

	it('converts message with images to multipart content array', () => {
		const msgs: Message[] = [
			{
				role: 'user',
				content: 'look at this',
				images: [{ name: 'img.png', dataUrl: 'data:image/png;base64,abc' }]
			}
		];
		const result = prepareMessagesForApi(msgs);
		const content = result[0].content as Array<Record<string, unknown>>;
		expect(Array.isArray(content)).toBe(true);
		expect(content[0]).toEqual({ type: 'text', text: 'look at this' });
		expect(content[1]).toEqual({
			type: 'image_url',
			image_url: { url: 'data:image/png;base64,abc' }
		});
	});

	it('includes multiple images in the content array', () => {
		const msgs: Message[] = [
			{
				role: 'user',
				content: 'two images',
				images: [
					{ name: 'a.png', dataUrl: 'data:image/png;base64,aaa' },
					{ name: 'b.png', dataUrl: 'data:image/png;base64,bbb' }
				]
			}
		];
		const result = prepareMessagesForApi(msgs);
		const content = result[0].content as Array<Record<string, unknown>>;
		expect(content).toHaveLength(3); // text + 2 images
	});

	it('includes tool_calls when present on assistant message', () => {
		const msgs: Message[] = [
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'tc1', function: { name: 'read_file', arguments: '{}' } }]
			}
		];
		const result = prepareMessagesForApi(msgs);
		expect(result[0].tool_calls).toBeDefined();
	});

	it('sets role to "tool" and includes tool_call_id when present', () => {
		const msgs: Message[] = [
			{ role: 'tool', content: 'result', tool_call_id: 'tc42' }
		];
		const result = prepareMessagesForApi(msgs);
		expect(result[0].role).toBe('tool');
		expect(result[0].tool_call_id).toBe('tc42');
	});

	it('does not include tool_calls key when tool_calls is null', () => {
		const msgs: Message[] = [
			{ role: 'assistant', content: 'response', tool_calls: null }
		];
		const result = prepareMessagesForApi(msgs);
		expect('tool_calls' in result[0]).toBe(false);
	});

	it('does not include tool_call_id key when tool_call_id is null', () => {
		const msgs: Message[] = [
			{ role: 'tool', content: 'result', tool_call_id: null }
		];
		const result = prepareMessagesForApi(msgs);
		expect('tool_call_id' in result[0]).toBe(false);
	});
});
