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

const listProps = { loading: false, hasMore: false, loadingMore: false, onLoadMore: vi.fn(), onDelete: vi.fn() };

describe('ItemList', () => {
  it('shows empty state, statuses and failure reasons', () => {
    const { rerender } = render(<ItemList {...listProps} items={[]} total={0} />);
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();

    rerender(
      <ItemList
        {...listProps}
        items={[item(), item({ id: '2', title: 'Bad page', status: 'failed', error: 'HTTP 404' })]}
        total={2}
      />,
    );
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('HTTP 404')).toBeInTheDocument();
  });

  it('shows the overall total and a Load more button with the remaining count', async () => {
    const onLoadMore = vi.fn();
    render(<ItemList {...listProps} items={[item()]} total={120} hasMore onLoadMore={onLoadMore} />);
    expect(screen.getByText('Saved items (120)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more (119 remaining)' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});

describe('AnswerCard / AskPanel', () => {
  it('renders the answer with numbered source snippets', () => {
    render(
      <AnswerCard
        result={{
          answer: 'Espresso uses 9 bars [1]',
          usedFallback: false,
          answeredBy: 'groq:openai/gpt-oss-120b',
          sources: [{ itemId: 'a', chunkId: 'c1', title: 'Coffee', sourceUrl: 'https://x.test', snippet: '9 bars of pressure', score: 0.8123 }],
        }}
      />,
    );
    expect(screen.getByText('Espresso uses 9 bars [1]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Coffee' })).toHaveAttribute('href', 'https://x.test');
    expect(screen.getByText(/9 bars of pressure/)).toBeInTheDocument();
    expect(screen.getByText(/0\.81/)).toBeInTheDocument();
  });

  it('explains a degraded answer with the server notice, and names the model otherwise', () => {
    const base = { answer: 'A', sources: [], usedFallback: false };
    const { rerender } = render(<AnswerCard result={{ ...base, answeredBy: 'groq:openai/gpt-oss-120b' }} />);
    expect(screen.getByText('Answered by groq:openai/gpt-oss-120b')).toBeInTheDocument();

    rerender(
      <AnswerCard
        result={{ ...base, usedFallback: true, answeredBy: 'extractive', notice: 'The language model was slow or unavailable.' }}
      />,
    );
    expect(screen.getByText('The language model was slow or unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/Answered by/)).not.toBeInTheDocument();
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
  it('polls only the processing listing and re-fetches just the items that finished', async () => {
    vi.useFakeTimers();
    const listItems = vi
      .fn()
      .mockResolvedValueOnce({ items: [item({ id: 'a', status: 'processing' }), item({ id: 'b' })], nextCursor: null, total: 2 })
      .mockResolvedValue({ items: [], nextCursor: null, total: 0 }); // nothing is processing any more
    const getItem = vi.fn().mockResolvedValue(item({ id: 'a', status: 'ready' }));
    const api = { listItems, getItem } as unknown as Api;

    const { result } = renderHook(() => useItems(api));
    await act(async () => {});
    expect(result.current.items[0]?.status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(listItems).toHaveBeenLastCalledWith({ status: 'processing', limit: 100 });
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith('a'); // item b was already ready: not re-fetched
    expect(result.current.items[0]?.status).toBe('ready');

    const calls = listItems.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(listItems.mock.calls.length).toBe(calls); // polling stopped
  });

  it('loads further pages with the cursor and does not duplicate items', async () => {
    const listItems = vi
      .fn()
      .mockResolvedValueOnce({ items: [item({ id: 'a' }), item({ id: 'b' })], nextCursor: 'c1', total: 3 })
      .mockResolvedValueOnce({ items: [item({ id: 'b' }), item({ id: 'c' })], nextCursor: null, total: 3 });
    const api = { listItems } as unknown as Api;

    const { result } = renderHook(() => useItems(api));
    await act(async () => {});
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(listItems).toHaveBeenLastCalledWith({ cursor: 'c1' });
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);
  });
});
