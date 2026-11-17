import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddItemForm, validateInput } from './components/AddItemForm';
import { AnswerCard } from './components/AnswerCard';
import { AskPanel } from './components/AskPanel';
import { ItemList } from './components/ItemList';
import { useItems } from './hooks/useItems';
import { renderHook, act } from '@testing-library/react';
import type { Api } from './api/client';
import type { ItemSummary } from './api/types';

const item = (over: Partial<ItemSummary> = {}): ItemSummary => ({
  id: '1',
  type: 'note',
  title: 'My note',
  sourceUrl: null,
  status: 'ready',
  error: null,
  chunkCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  preview: 'hello',
  ...over,
});

afterEach(() => vi.useRealTimers());

describe('validateInput', () => {
  it('flags empty, oversized and non-http input', () => {
    expect(validateInput('note', '  ')).toMatch(/Write a note/);
    expect(validateInput('note', 'x'.repeat(20_001))).toMatch(/limited/);
    expect(validateInput('url', 'example.com')).toMatch(/http/);
    expect(validateInput('url', 'https://example.com')).toBeNull();
  });
});

describe('AddItemForm', () => {
  it('submits a trimmed note and clears the field', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddItemForm onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText('Note'), '  remember this ');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(onAdd).toHaveBeenCalledWith({ type: 'note', content: 'remember this' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue(''));
  });

  it('shows validation and server errors without losing input', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('URL points to a private address'));
    render(<AddItemForm onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('tab', { name: 'URL' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save URL' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a URL first.');

    await userEvent.type(screen.getByLabelText('URL'), 'http://localhost:3001');
    await userEvent.click(screen.getByRole('button', { name: 'Save URL' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('private address');
    expect(screen.getByLabelText('URL')).toHaveValue('http://localhost:3001');
  });
});

describe('ItemList', () => {
  it('shows empty state, statuses and failure reasons', () => {
    const { rerender } = render(<ItemList items={[]} loading={false} onDelete={vi.fn()} />);
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();

    rerender(
      <ItemList
        items={[item(), item({ id: '2', title: 'Bad page', status: 'failed', error: 'HTTP 404' })]}
        loading={false}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('HTTP 404')).toBeInTheDocument();
  });
});

describe('AnswerCard / AskPanel', () => {
  it('renders the answer with numbered source snippets', () => {
    render(
      <AnswerCard
        result={{
          answer: 'Espresso uses 9 bars [1]',
          usedFallback: false,
          sources: [{ itemId: 'a', chunkId: 'c1', title: 'Coffee', sourceUrl: 'https://x.test', snippet: '9 bars of pressure', score: 0.8123 }],
        }}
      />,
    );
    expect(screen.getByText('Espresso uses 9 bars [1]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Coffee' })).toHaveAttribute('href', 'https://x.test');
    expect(screen.getByText(/9 bars of pressure/)).toBeInTheDocument();
    expect(screen.getByText(/0\.81/)).toBeInTheDocument();
  });

  it('only enables Ask for a real question', async () => {
    const onAsk = vi.fn();
    render(<AskPanel onAsk={onAsk} asking={false} result={null} error="boom" />);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    await userEvent.type(screen.getByLabelText('Question'), 'what is espresso?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onAsk).toHaveBeenCalledWith('what is espresso?');
  });
});

describe('useItems', () => {
  it('polls while an item is processing and stops once ready', async () => {
    vi.useFakeTimers();
    const listItems = vi
      .fn()
      .mockResolvedValueOnce([item({ status: 'processing' })])
      .mockResolvedValue([item({ status: 'ready' })]);
    const api = { listItems } as unknown as Api;

    const { result } = renderHook(() => useItems(api));
    await act(async () => {});
    expect(result.current.items[0]?.status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.items[0]?.status).toBe('ready');

    const calls = listItems.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(listItems.mock.calls.length).toBe(calls); // no more polling
  });
});
