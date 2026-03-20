import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Mock readline before importing the module under test. */
const mockQuestion = vi.fn<(q: string, cb: (answer: string) => void) => void>();
const mockClose = vi.fn();

vi.mock('node:readline', () => ({
  createInterface: () => ({ question: mockQuestion, close: mockClose }),
}));

/* Import after mocks are in place. */
const { ask, choose, closePrompts } = await import('./prompts.js');

describe('ask', () => {
  beforeEach(() => {
    mockQuestion.mockReset();
  });

  it('resolves with the user answer', async () => {
    mockQuestion.mockImplementation((_q, cb) => cb('hello'));

    const result = await ask('Name: ');
    expect(result).toBe('hello');
    expect(mockQuestion).toHaveBeenCalledWith('Name: ', expect.any(Function));
  });

  it('resolves with empty string when user provides no input', async () => {
    mockQuestion.mockImplementation((_q, cb) => cb(''));

    const result = await ask('Prompt: ');
    expect(result).toBe('');
  });
});

describe('choose', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockQuestion.mockReset();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('displays the question and numbered options', async () => {
    mockQuestion.mockImplementation((_q, cb) => cb('2'));

    await choose('Pick a colour:', ['Red', 'Blue'], 1);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Pick a colour:');
    expect(output).toContain('1) Red');
    expect(output).toContain('2) Blue');
  });

  it('returns the user selection when provided', async () => {
    mockQuestion.mockImplementation((_q, cb) => cb('2'));

    const result = await choose('Pick:', ['A', 'B'], 1);
    expect(result).toBe('2');
  });

  it('returns the default choice when user presses enter', async () => {
    mockQuestion.mockImplementation((_q, cb) => cb(''));

    const result = await choose('Pick:', ['A', 'B'], 1);
    expect(result).toBe('1');
  });

  it('returns the default choice when user enters only whitespace', async () => {
    mockQuestion.mockImplementation((_q, cb) => cb('   '));

    const result = await choose('Pick:', ['A', 'B'], 2);
    expect(result).toBe('2');
  });

  it('uses 1 as default when no defaultChoice is specified', async () => {
    mockQuestion.mockImplementation((_q, cb) => cb(''));

    const result = await choose('Pick:', ['X', 'Y']);
    expect(result).toBe('1');
  });
});

describe('closePrompts', () => {
  beforeEach(() => {
    mockClose.mockReset();
  });

  it('closes the readline interface', () => {
    closePrompts();
    expect(mockClose).toHaveBeenCalled();
  });
});
