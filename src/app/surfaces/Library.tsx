import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MessageCircle, NotebookPen, Search } from 'lucide-react';
import { SurfaceBar, useSurface } from '../ui/Surface';
import { db } from '../../lib/db';
import { relativeTime } from '../../lib/text';
import { DraftRow, Row, noteTitle } from '../Home';

type Tab = 'drafts' | 'chats' | 'notes';

export function LibrarySurface({ tab: initial }: { tab?: string }) {
  const { open, replace } = useSurface();
  const [tab, setTab] = useState<Tab>((initial as Tab) || 'drafts');
  const [q, setQ] = useState('');
  const drafts = useLiveQuery(() => db.drafts.orderBy('updatedAt').reverse().filter((d) => !d.recordingActive).toArray(), []);
  const chats = useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().toArray(), []);
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), []);
  const needle = q.trim().toLowerCase();

  const list = useMemo(() => {
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    if (tab === 'drafts') return (drafts ?? []).filter((d) => match(d.title + ' ' + d.versions.map((v) => v.text).join(' ')));
    if (tab === 'chats') return (chats ?? []).filter((c) => match(c.title));
    return (notes ?? []).filter((n) => n.body.trim() && match(n.body));
  }, [tab, drafts, chats, notes, needle]);

  const counts = { drafts: drafts?.length ?? 0, chats: chats?.length ?? 0, notes: (notes ?? []).filter((n) => n.body.trim()).length };

  return (
    <div className="tool tool-library">
      <SurfaceBar title="Library" />
      <div className="library-top">
        <div className="tabs" role="tablist" aria-label="Library">
          {(['drafts', 'chats', 'notes'] as Tab[]).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} className={`tab${tab === t ? ' is-on' : ''}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              <span className="tab-count">{counts[t]}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} />
        </label>
      </div>
      <div className="tool-scroll">
        {list.length === 0 ? (
          <p className="empty-tool">{needle ? 'Nothing matches that search.' : tab === 'drafts' ? 'Recordings and typed prompts appear here.' : tab === 'chats' ? 'Answers you get from AI appear here.' : 'Notes you write appear here.'}</p>
        ) : (
          <ul className="rows">
            {tab === 'drafts' &&
              (list as NonNullable<typeof drafts>).map((d) => (
                <li key={d.id}>
                  <DraftRow draft={d} onOpen={() => replace({ kind: 'draft', id: d.id })} />
                </li>
              ))}
            {tab === 'chats' &&
              (list as NonNullable<typeof chats>).map((c) => (
                <li key={c.id}>
                  <Row icon={<MessageCircle />} title={c.title} meta={[relativeTime(c.updatedAt), c.localOnly ? 'Device only' : '']} onOpen={() => replace({ kind: 'chat', id: c.id })} />
                </li>
              ))}
            {tab === 'notes' &&
              (list as NonNullable<typeof notes>).map((n) => (
                <li key={n.id}>
                  <Row icon={<NotebookPen />} title={noteTitle(n)} meta={[relativeTime(n.updatedAt), n.summary ? 'Summarized' : '']} onOpen={() => replace({ kind: 'note', id: n.id })} />
                </li>
              ))}
          </ul>
        )}
      </div>
      {tab === 'notes' ? (
        <footer className="tool-foot single">
          <button type="button" className="btn btn-line" onClick={() => open({ kind: 'note', id: 'new', enter: 'rise' })}>
            <NotebookPen aria-hidden />
            New note
          </button>
        </footer>
      ) : null}
    </div>
  );
}
