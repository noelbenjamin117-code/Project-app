import type { Metadata } from 'next';
import { WhiteboardScreen } from './whiteboard-screen';

export const metadata: Metadata = {
  title: 'Whiteboard',
  // The TV should never be indexed, and never prompt anything.
  robots: { index: false, follow: false },
};

/**
 * TV mode: no login, no interaction, sized for a 1920x1080 panel read from
 * twenty feet away. The initial payload is fetched by the client so this page
 * itself stays static and cheap to reload.
 */
export default function WhiteboardPage() {
  return <WhiteboardScreen />;
}
