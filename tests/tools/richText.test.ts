import { describe, it, expect } from 'vitest';
import {
  wrapRichText,
  wrapTestCaseSteps,
} from '../../src/tools/testmanagement-utils/rich-text';

describe('wrapRichText', () => {
  it('wraps bare text containing > in <p> tags', () => {
    expect(wrapRichText('Navigate to Settings > Users')).toBe(
      '<p>Navigate to Settings > Users</p>',
    );
  });

  it('wraps bare text containing < in <p> tags', () => {
    expect(wrapRichText('if a < b then pass')).toBe(
      '<p>if a < b then pass</p>',
    );
  });

  it('wraps bare text containing & in <p> tags', () => {
    expect(wrapRichText('Q&A section loads')).toBe('<p>Q&A section loads</p>');
  });

  it('leaves text without <, > or & untouched', () => {
    expect(wrapRichText('Click "Save" then \'Confirm\'')).toBe(
      'Click "Save" then \'Confirm\'',
    );
  });

  it('leaves already-HTML content untouched', () => {
    expect(wrapRichText('<p>Settings &gt; Users</p>')).toBe(
      '<p>Settings &gt; Users</p>',
    );
    expect(wrapRichText('  <ul><li>A &amp; B</li></ul>')).toBe(
      '  <ul><li>A &amp; B</li></ul>',
    );
  });

  it('wraps text starting with < that is not a tag', () => {
    expect(wrapRichText('< 5 items are shown')).toBe(
      '<p>< 5 items are shown</p>',
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
      { step: '<p>Go to A > B</p>', result: 'B page loads' },
      { step: 'Click Save', result: '<p>Count > 0</p>' },
    ]);
  });

  it('returns an empty array unchanged', () => {
    expect(wrapTestCaseSteps([])).toEqual([]);
  });
});
