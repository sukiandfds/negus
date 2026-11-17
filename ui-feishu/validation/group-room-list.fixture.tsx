import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useGroupChats } from '../src/useGroupChats';

function Fixture() {
  const { rooms } = useGroupChats();
  const [renderedAt, setRenderedAt] = useState(0);
  useEffect(() => setRenderedAt(value => value + 1), [rooms]);
  return <pre data-room-list>{JSON.stringify({ rooms, renderedAt })}</pre>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
