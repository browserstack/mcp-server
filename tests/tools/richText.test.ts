import { describe, it, expect } from 'vitest';
import {
  wrapRichText,
  wrapTestCaseSteps,
} from '../../src/tools/testmanagement-utils/rich-text';

describe('wrapRichText', () => {
  it('escapes and wraps bare text containing >', () => {
    expect(wrapRichText('Navigate to Settings > Users')).toBe(
      '<p>Navigate to Settings &gt; Users</p>',
    );
  });

  it('escapes and wraps bare text containing <', () => {
    expect(wrapRichText('if a < b then pass')).toBe(
      '<p>if a &lt; b then pass</p>',
    );
  });

  it('escapes and wraps bare text containing &', () => {
    expect(wrapRichText('Q&A section loads')).toBe(
      '<p>Q&amp;A section loads</p>',
    );
  });

  it('preserves tag-like tokens that TM would otherwise strip', () => {
    expect(wrapRichText('Press <Enter> to submit the form')).toBe(
      '<p>Press &lt;Enter&gt; to submit the form</p>',
    );
    expect(wrapRichText('Use List<String> where A > B & C')).toBe(
      '<p>Use List&lt;String&gt; where A &gt; B &amp; C</p>',
    );
    // Leading tag-like token that is NOT a TM-allowed tag is literal text too.
    expect(wrapRichText('<Enter> key submits the form')).toBe(
      '<p>&lt;Enter&gt; key submits the form</p>',
    );
    expect(wrapRichText('<h1>not an allowed TM tag</h1>')).toBe(
      '<p>&lt;h1&gt;not an allowed TM tag&lt;/h1&gt;</p>',
    );
  });

  it('leaves text without <, > or & untouched', () => {
    expect(wrapRichText('Click "Save" then \'Confirm\'')).toBe(
      'Click "Save" then \'Confirm\'',
    );
  });

  it('leaves content starting with a TM-allowed tag untouched', () => {
    expect(wrapRichText('<p>Settings &gt; Users</p>')).toBe(
      '<p>Settings &gt; Users</p>',
    );
    expect(wrapRichText('  <ul><li>A &amp; B</li></ul>')).toBe(
      '  <ul><li>A &amp; B</li></ul>',
    );
    expect(wrapRichText('<br/>')).toBe('<br/>');
  });

  it('treats a leading < that is not a tag as literal text', () => {
    expect(wrapRichText('< 5 items are shown')).toBe(
      '<p>&lt; 5 items are shown</p>',
    );
  });

  it('handles any characters, not just fixed strings', () => {
    expect(wrapRichText('émojis 🎉 and ünïcode ≥ 5 stay bare')).toBe(
      'émojis 🎉 and ünïcode ≥ 5 stay bare',
    );
    expect(wrapRichText('unicode plus html char: 温度 > 30°C')).toBe(
      '<p>unicode plus html char: 温度 &gt; 30°C</p>',
    );
    expect(wrapRichText('line1 a > b\nline2 c < d')).toBe(
      '<p>line1 a &gt; b\nline2 c &lt; d</p>',
    );
    expect(wrapRichText('a>=b && c<=d & "e"')).toBe(
      '<p>a&gt;=b &amp;&amp; c&lt;=d &amp; "e"</p>',
    );
  });
});

describe('wrapTestCaseSteps', () => {
  it('wraps step and result independently and preserves other keys', () => {
    expect(
      wrapTestCaseSteps([
        { step: 'Go to A > B', result: 'B page loads' },
        { step: 'Click Save', result: 'Count > 0' },
      ]),
    ).toEqual([
      { step: '<p>Go to A &gt; B</p>', result: 'B page loads' },
      { step: 'Click Save', result: '<p>Count &gt; 0</p>' },
    ]);
  });

  it('returns an empty array unchanged', () => {
    expect(wrapTestCaseSteps([])).toEqual([]);
  });
});
